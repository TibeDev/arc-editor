import { Minus, X } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

function withWindow(action: (window: ReturnType<typeof getCurrentWindow>) => void) {
  if (isTauri()) action(getCurrentWindow());
}

const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'North', className: 'north' },
  { direction: 'South', className: 'south' },
  { direction: 'East', className: 'east' },
  { direction: 'West', className: 'west' },
  { direction: 'NorthEast', className: 'north-east' },
  { direction: 'NorthWest', className: 'north-west' },
  { direction: 'SouthEast', className: 'south-east' },
  { direction: 'SouthWest', className: 'south-west' },
];

export default function TitleBar() {
  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-drag" data-tauri-drag-region />
        <div className="titlebar-controls">
          <button
            className="titlebar-button"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => withWindow((window) => void window.minimize())}
          >
            <Minus size={14} />
          </button>
          <button
            className="titlebar-button titlebar-close"
            aria-label="Close window"
            title="Close"
            onClick={() => withWindow((window) => void window.close())}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="window-resize-handles" aria-hidden>
        {resizeHandles.map((handle) => (
          <span
            key={handle.direction}
            className={`window-resize-handle ${handle.className}`}
            onPointerDown={(event) => {
              event.preventDefault();
              withWindow((window) =>
                void window.startResizeDragging(handle.direction),
              );
            }}
          />
        ))}
      </div>
    </>
  );
}
