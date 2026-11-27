import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ColorResolver, defaultTheme, open, type RioTermHandle, type Theme } from "rioterm";
import { subscribeTerminalOutput, terminalOutputReady } from "../lib/terminalOutput";
import { resolveTerminalFont, themeColorWithOpacity, type AppSettings, type ThemeDefinition } from "../lib/settings";

type TerminalSession = { id: string; cwd: string; command?: string };
type TerminalSettings = Pick<AppSettings,
  "terminalFontFamily" | "terminalFontSize" | "terminalCursorStyle"
  | "terminalScrollback" | "terminalPadding" | "terminalSelectionColor"
  | "editorGlassEnabled" | "glassTerminalTransparency" | "appTheme"
>;

function backgroundAlpha(color: string): number {
  const match = /^rgba\([^)]*,\s*([\d.]+)\)$/i.exec(color);
  return match ? Number(match[1]) : 1;
}

function colorChannels(color: string): [number, number, number] | undefined {
  const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/i.exec(color)?.[1];
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
  const rgb = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

function withCellAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const channels = colorChannels(color);
  if (!channels) return color;
  const hex = channels.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `#${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

function isDark(color: string): boolean {
  const channels = colorChannels(color);
  return channels !== undefined && Math.max(...channels) < 96;
}

const resolveCellColor = ColorResolver.prototype.resolve;
ColorResolver.prototype.resolve = function (this: ColorResolver, packed: number, isForeground: boolean) {
  const color = resolveCellColor.call(this, packed, isForeground);
  const alpha = backgroundAlpha(this.theme.background);
  if (alpha >= 1) return color;
  if (!isForeground) return withCellAlpha(color, alpha);
  return isDark(this.theme.background) && isDark(color) ? withCellAlpha(color, alpha) : color;
};

function terminalTheme(theme: ThemeDefinition, settings: TerminalSettings): Theme {
  return {
    ...defaultTheme,
    background: settings.editorGlassEnabled
      ? themeColorWithOpacity(theme.colors.editor, 1 - settings.glassTerminalTransparency / 100)
      : theme.colors.editor,
    foreground: theme.colors.text,
    cursor: theme.colors.cursor,
    selectionBackground: settings.terminalSelectionColor || theme.colors.selection,
  };
}

export default function TerminalView({ session, active, theme, settings, onTitleChange }: {
  session: TerminalSession;
  active: boolean;
  theme: ThemeDefinition;
  settings: TerminalSettings;
  onTitleChange: (id: string, title: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<RioTermHandle | null>(null);
  const activeRef = useRef(active);
  const fontFamily = resolveTerminalFont(settings);
  const transparent = settings.editorGlassEnabled && settings.glassTerminalTransparency > 0;

  useEffect(() => {
    activeRef.current = active;
    if (active) handle.current?.focus();
  }, [active]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanupSession: (() => void) | undefined;

    const start = async () => {
      try {
        await terminalOutputReady();
        if (disposed) return;
        const opened = await open(element, {
          renderer: transparent ? "dom" : "canvas",
          autoFocus: false,
          fit: false,
          scrollback: settings.terminalScrollback,
          fontSize: settings.terminalFontSize,
          fontFamily,
          cursorStyle: settings.terminalCursorStyle,
          theme: terminalTheme(theme, settings),
        });
        if (disposed) {
          opened.dispose();
          return;
        }
        handle.current = opened;
        const term = opened.terminal;
        const decoder = new TextDecoder();
        let suppressInput = false;
        let inputBuffer = "";
        let inputTimer: number | null = null;
        let lastSize = "";

        const flushInput = () => {
          inputTimer = null;
          if (!inputBuffer) return;
          const pending = inputBuffer;
          inputBuffer = "";
          void invoke("terminal_write", { id: session.id, data: pending }).catch((error) => {
            if (!disposed) term.write(`\r\nTerminal input failed: ${String(error)}\r\n`);
          });
        };

        const syncSize = (force = false) => {
          const size = `${term.options.cols}x${term.options.rows}`;
          if (!force && size === lastSize) return;
          lastSize = size;
          void invoke("terminal_resize", {
            id: session.id,
            cols: term.options.cols,
            rows: term.options.rows,
          }).catch(() => undefined);
        };

        const renderer = opened.renderer;
        if (transparent) renderer.element.style.backgroundColor = "transparent";
        const baseCellWidth = renderer.cellWidth;
        const baseCellHeight = renderer.cellHeight;
        let fitFrame: number | null = null;
        const fitToSurface = () => {
          const width = element.clientWidth;
          const height = element.clientHeight;
          if (!width || !height || !baseCellWidth || !baseCellHeight) return;
          const cols = Math.max(2, Math.floor(width / baseCellWidth));
          const rows = Math.max(2, Math.floor(height / baseCellHeight));
          const cellWidth = width / cols;
          (renderer as unknown as { cellWidth: number }).cellWidth = cellWidth;
          term.setCellSize(cellWidth, baseCellHeight);
          if (cols !== term.options.cols || rows !== term.options.rows) term.resize(cols, rows);
          if (renderer.element instanceof HTMLCanvasElement) {
            renderer.schedule();
          } else {
            renderer.element.style.letterSpacing = `${cellWidth - baseCellWidth}px`;
          }
        };
        const fitObserver = new ResizeObserver(() => {
          if (fitFrame !== null) return;
          fitFrame = window.requestAnimationFrame(() => {
            fitFrame = null;
            if (!disposed) fitToSurface();
          });
        });
        fitObserver.observe(element);
        fitToSurface();

        const disposables = [
          term.onUpdate(() => syncSize()),
          term.onTitleChange((title) => onTitleChange(session.id, title.trim() || "Terminal")),
          term.onData((bytes) => {
            if (suppressInput || disposed) return;
            inputBuffer += decoder.decode(bytes);
            if (inputTimer === null) inputTimer = window.setTimeout(flushInput, 8);
          }),
        ];

        const unsubscribe = subscribeTerminalOutput(session.id, (data, replay) => {
          if (replay) suppressInput = true;
          try {
            term.write(data);
          } finally {
            if (replay) suppressInput = false;
          }
        });

        if (activeRef.current) opened.focus();

        cleanupSession = () => {
          unsubscribe();
          fitObserver.disconnect();
          if (fitFrame !== null) {
            window.cancelAnimationFrame(fitFrame);
            fitFrame = null;
          }
          for (const disposable of disposables) disposable.dispose();
          if (inputTimer !== null) {
            window.clearTimeout(inputTimer);
            inputTimer = null;
          }
        };

        await invoke("terminal_spawn", {
          id: session.id,
          cwd: session.cwd || null,
          command: session.command ?? null,
        });
        if (!disposed) syncSize(true);
      } catch (error) {
        if (!disposed && host.current) {
          host.current.textContent = `Terminal failed to start: ${String(error)}`;
        }
      }
    };

    void start();

    return () => {
      disposed = true;
      cleanupSession?.();
      handle.current?.dispose();
      handle.current = null;
    };
  }, [
    session.id,
    session.cwd,
    session.command,
    onTitleChange,
    fontFamily,
    settings.terminalFontSize,
    settings.terminalScrollback,
    settings.terminalCursorStyle,
    settings.terminalSelectionColor,
    settings.editorGlassEnabled,
    settings.glassTerminalTransparency,
    theme,
  ]);

  return (
    <div
      className="terminal-view"
      style={{ padding: settings.terminalPadding }}
      aria-label="Terminal"
    >
      <div ref={host} className="terminal-surface" />
    </div>
  );
}
