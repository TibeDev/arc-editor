import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

function rgbFromHex(hex: string) {
  const value = hex.slice(1, 7);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function hsvFromRgb([red, green, blue]: number[]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { h: (hue + 360) % 360, s: max ? delta / max : 0, v: max };
}

function rgbFromHsv({ h, s, v }: { h: number; s: number; v: number }) {
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const match = v - chroma;
  const rgb = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map((channel) => Math.round((channel + match) * 255));
}

function hexWithRgb(hex: string, rgb: number[]) {
  return `#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}${hex.length === 9 ? hex.slice(7) : ""}`;
}

export default function ThemeColorPicker({ label, value, onChange, onOpenChange }: { label: string; value: string; onChange: (value: string) => void; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [opensAbove, setOpensAbove] = useState(false);
  const [hexDraft, setHexDraft] = useState(value.slice(0, 7));
  const [hsv, setHsv] = useState(() => hsvFromRgb(rgbFromHex(value)));
  const anchor = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setHexDraft(value.slice(0, 7));
    setHsv(hsvFromRgb(rgbFromHex(value)));
  }, [value]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popover.current) return;
    const scrollContainer = anchor.current.closest<HTMLElement>(".settings-scroll, .theme-controls");
    if (!scrollContainer) return;
    const updatePlacement = () => {
      const anchorElement = anchor.current;
      const popoverElement = popover.current;
      if (!anchorElement || !popoverElement) return;
      const anchorBounds = anchorElement.getBoundingClientRect();
      const scrollBounds = scrollContainer.getBoundingClientRect();
      const popoverHeight = popoverElement.getBoundingClientRect().height;
      const spaceBelow = scrollBounds.bottom - anchorBounds.bottom;
      const spaceAbove = anchorBounds.top - scrollBounds.top;
      setOpensAbove(spaceBelow < popoverHeight && spaceAbove > spaceBelow);
    };
    updatePlacement();
    scrollContainer.addEventListener("scroll", updatePlacement);
    window.addEventListener("resize", updatePlacement);
    return () => {
      scrollContainer.removeEventListener("scroll", updatePlacement);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [open]);
  const updateSv = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = {
      ...hsv,
      s: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    setHsv(next);
    onChange(hexWithRgb(value, rgbFromHsv(next)));
  };
  const updateHue = (h: number) => {
    const next = { ...hsv, h };
    setHsv(next);
    onChange(hexWithRgb(value, rgbFromHsv(next)));
  };
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return <div className="theme-color-picker">
    <div ref={anchor} className={`theme-color-anchor ${opensAbove ? "opens-above" : ""}`} onMouseLeave={() => changeOpen(false)}>
      <button type="button" className="theme-color-swatch" aria-label={`Change ${label} color`} aria-expanded={open} title={`${label}: ${value}`} style={{ backgroundColor: value.slice(0, 7), borderColor: "#ffffff70" }} onClick={() => changeOpen(!open)} />
      {open && <div ref={popover} className="theme-color-popover">
      <strong>{label}</strong>
      <label className="theme-picker-hex">Hex<input value={hexDraft} spellCheck={false} onChange={(event) => {
        setHexDraft(event.target.value);
        if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(`${event.target.value}${value.length === 9 ? value.slice(7) : ""}`);
      }} /></label>
      <div className="theme-picker-sv" role="group" aria-label="Saturation and brightness" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); updateSv(event); }} onPointerMove={(event) => { if (event.buttons) updateSv(event); }}>
        <i className="theme-picker-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <label className="theme-picker-hue"><span>Hue</span><input aria-label="Hue" type="range" min="0" max="360" value={Math.round(hsv.h)} onChange={(event) => updateHue(Number(event.target.value))} /></label>
      <button type="button" className="theme-picker-done" onClick={() => changeOpen(false)}>Done</button>
      </div>}
    </div>
  </div>;
}
