import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./Select.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function readVar(style: CSSStyleDeclaration, names: string[], fallback: string) {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return fallback;
}

export default function Select({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  title,
  placeholder = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openMenu = useCallback(() => {
    if (disabled) return;
    const next = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled);
    setActiveIndex(next);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const closeMenu = useCallback(() => setOpen(false), []);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const style = getComputedStyle(trigger);
    const text = readVar(style, ["--theme-text", "--settings-text", "--macos-text", "--text"], style.color);
    const background = readVar(
      style,
      ["--theme-raised", "--settings-raised", "--macos-sidebar", "--panel"],
      style.backgroundColor,
    );
    const border = readVar(style, ["--theme-border", "--settings-border", "--macos-border", "--line"], style.borderColor);
    const muted = readVar(style, ["--theme-muted", "--settings-muted", "--macos-secondary", "--muted"], text);
    const hover = readVar(style, ["--theme-hover", "--macos-hover"], `color-mix(in srgb, ${text} 9%, ${background})`);
    const selectedFill = readVar(
      style,
      ["--theme-selected", "--selected", "--macos-selected"],
      `color-mix(in srgb, ${text} 17%, ${background})`,
    );
    const itemHeight = 27;
    const menuHeight = Math.min(options.length * itemHeight + 8, 288);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const top = openUp ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));

    setMenuStyle({
      top,
      left,
      width: Math.max(rect.width, 140),
      maxHeight: menuHeight,
      background,
      color: text,
      borderColor: border,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      "--arc-select-hover": hover,
      "--arc-select-selected": selectedFill,
      "--arc-select-muted": muted,
    } as CSSProperties);
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const typeahead = (key: string) => {
    const start = activeIndex >= 0 ? activeIndex : -1;
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + step) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(key)) {
        setActiveIndex(index);
        setOpen(true);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openMenu();
        return;
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeahead(key.toLowerCase());
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (key === "Tab") {
      setOpen(false);
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      const start = key === "Home" ? 0 : options.length - 1;
      const direction = key === "Home" ? 1 : -1;
      let index = start;
      for (let step = 0; step < options.length; step += 1) {
        if (!options[index]?.disabled) {
          setActiveIndex(index);
          return;
        }
        index += direction;
      }
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(key.toLowerCase());
    }
  };

  return (
    <span className="arc-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="arc-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        title={title ?? selected?.label ?? undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="arc-select-value">{selected?.label ?? placeholder}</span>
        <ChevronDown size={12} className="arc-select-caret" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="arc-select-menu"
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              className="arc-select-option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === activeIndex || undefined}
              disabled={option.disabled}
              onClick={() => choose(index)}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
            >
              <span className="arc-select-option-label">{option.label}</span>
              {option.value === value && <Check size={12} className="arc-select-check" aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
