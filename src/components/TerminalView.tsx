import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { subscribeTerminalOutput, terminalOutputReady } from "../lib/terminalOutput";
import { themeColorWithOpacity, type AppSettings, type ThemeDefinition } from "../lib/settings";

type TerminalSession = { id: string; cwd: string; command?: string };
type TerminalSettings = Pick<AppSettings,
  "terminalFontFamily" | "terminalFontSize" | "terminalCursorStyle" | "terminalCursorBlink"
  | "terminalScrollback" | "terminalPadding" | "terminalScrollbar" | "terminalSelectionColor"
  | "editorGlassEnabled" | "glassTerminalTransparency"
>;

export default function TerminalView({ session, active, theme, settings, onTitleChange }: {
  session: TerminalSession;
  active: boolean;
  theme: ThemeDefinition;
  settings: TerminalSettings;
  onTitleChange: (id: string, title: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const writeFrame = useRef<number | null>(null);
  const writeBuffer = useRef("");
  const inputTimer = useRef<number | null>(null);
  const inputBuffer = useRef("");
  const lastSize = useRef("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const xterm = new Terminal({
      cursorBlink: settings.terminalCursorBlink,
      cursorStyle: settings.terminalCursorStyle,
      fontFamily: settings.terminalFontFamily,
      fontSize: settings.terminalFontSize,
      scrollback: settings.terminalScrollback,
      theme: {
        background: settings.editorGlassEnabled
          ? themeColorWithOpacity(theme.colors.editor, 1 - settings.glassTerminalTransparency / 100)
          : theme.colors.editor,
        foreground: theme.colors.text,
        cursor: theme.colors.cursor,
        selectionBackground: settings.terminalSelectionColor || theme.colors.selection,
      },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host.current);
    const titleChange = xterm.onTitleChange((title) => onTitleChange(session.id, title.trim() || "Terminal"));
    terminal.current = xterm;
    fit.current = fitAddon;

    let disposed = false;
    let input: { dispose: () => void } | undefined;
    const queueWrite = (data: string) => {
      writeBuffer.current += data;
      if (writeFrame.current !== null) return;
      writeFrame.current = window.requestAnimationFrame(() => {
        writeFrame.current = null;
        const pending = writeBuffer.current;
        writeBuffer.current = "";
        if (pending) xterm.write(pending);
      });
    };
    const flushInput = () => {
      inputTimer.current = null;
      const pending = inputBuffer.current;
      inputBuffer.current = "";
      if (!pending) return;
      void invoke("terminal_write", { id: session.id, data: pending }).catch((error) =>
        xterm.write(`\r\nTerminal input failed: ${String(error)}\r\n`),
      );
    };
    const unsubscribe = subscribeTerminalOutput(session.id, queueWrite);
    void terminalOutputReady().then(() => invoke("terminal_spawn", { id: session.id, cwd: session.cwd || null, command: session.command ?? null }))
      .then(() => {
        if (disposed) return;
        input = xterm.onData((data) => {
          inputBuffer.current += data;
          if (inputTimer.current === null)
            inputTimer.current = window.setTimeout(flushInput, 8);
        });
        setReady(true);
      })
      .catch((error) => xterm.write(`Terminal failed to start: ${String(error)}\r\n`));

    return () => {
      disposed = true;
      unsubscribe();
      input?.dispose();
      if (inputTimer.current !== null) {
        window.clearTimeout(inputTimer.current);
        flushInput();
      }
      if (writeFrame.current !== null) {
        window.cancelAnimationFrame(writeFrame.current);
        writeFrame.current = null;
      }
      writeBuffer.current = "";
      titleChange.dispose();
      xterm.dispose();
      terminal.current = null;
      fit.current = null;
      setReady(false);
    };
  }, [session.id, session.cwd, session.command, onTitleChange]);

  useEffect(() => {
    const xterm = terminal.current;
    if (!xterm) return;
    xterm.options.cursorBlink = settings.terminalCursorBlink;
    xterm.options.cursorStyle = settings.terminalCursorStyle;
    xterm.options.fontFamily = settings.terminalFontFamily;
    xterm.options.fontSize = settings.terminalFontSize;
    xterm.options.scrollback = settings.terminalScrollback;
    xterm.options.theme = {
      background: settings.editorGlassEnabled
        ? themeColorWithOpacity(theme.colors.editor, 1 - settings.glassTerminalTransparency / 100)
        : theme.colors.editor,
      foreground: theme.colors.text,
      cursor: theme.colors.cursor,
      selectionBackground: settings.terminalSelectionColor || theme.colors.selection,
    };
  }, [settings.terminalCursorBlink, settings.terminalCursorStyle, settings.terminalFontFamily, settings.terminalFontSize, settings.terminalScrollback, settings.terminalSelectionColor, settings.editorGlassEnabled, settings.glassTerminalTransparency, theme]);

  useEffect(() => {
    if (!ready || !active || !host.current || !terminal.current || !fit.current) return;
    let frame: number | null = null;
    const resize = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const xterm = terminal.current;
        const fitAddon = fit.current;
        if (!active || !host.current?.clientWidth || !host.current.clientHeight || !xterm || !fitAddon) return;
        try {
          fitAddon.fit();
          const size = `${xterm.cols}x${xterm.rows}`;
          if (size === lastSize.current) return;
          lastSize.current = size;
          void invoke("terminal_resize", { id: session.id, cols: xterm.cols, rows: xterm.rows });
        } catch { /* Terminal may not have measurable dimensions yet. */ }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    requestAnimationFrame(() => {
      resize();
      terminal.current?.focus();
    });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [active, ready, session.id, settings.terminalFontFamily, settings.terminalFontSize, settings.terminalPadding]);

  return <div
    ref={host}
    className={`terminal-view ${settings.terminalScrollbar ? "" : "hide-scrollbar"}`}
    style={{ padding: settings.terminalPadding }}
    aria-label="Terminal"
  />;
}
