import { useRef, useState, type PointerEvent } from "react";
import type { BlockName } from "../../shared/types";
import { BLOCKS, PALETTE } from "./catalog";

const DRAG_START_PX = 6;

interface PaletteProps {
  disabled: boolean;
  onInsert: (name: BlockName) => void;
  /** Called while a block is dragged; the owner finds the drop gap under the pointer and shows it. */
  onDrag: (name: BlockName, x: number, y: number) => void;
  /** Called when a dragged block is let go; the owner inserts it at the gap it showed. */
  onDrop: (name: BlockName) => void;
  onDragCancel: () => void;
}

interface Dragging {
  name: BlockName;
  x: number;
  y: number;
}

/** The palette: click or press Enter to insert at the insertion point, or drag a block into the program with a mouse or pen. */
export function Palette({ disabled, onInsert, onDrag, onDrop, onDragCancel }: PaletteProps) {
  const press = useRef<{ x: number; y: number; started: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (disabled || event.pointerType === "touch" || event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLButtonElement>, name: BlockName) => {
    const from = press.current;
    if (!from) return;
    if (!from.started && Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_START_PX) return;
    from.started = true;
    setDragging({ name, x: event.clientX, y: event.clientY });
    onDrag(name, event.clientX, event.clientY);
  };

  const up = (name: BlockName) => {
    const from = press.current;
    press.current = null;
    if (!from?.started) return;
    suppressClick.current = true;
    setDragging(null);
    onDrop(name);
  };

  const cancel = () => {
    if (press.current?.started) onDragCancel();
    press.current = null;
    setDragging(null);
  };

  return (
    <>
      <div className="bl-palette" role="toolbar" aria-label="Blocks palette" aria-orientation="vertical">
        {PALETTE.map((name) => {
          const { label, icon: Icon, group } = BLOCKS[name];
          return (
            <button
              key={name}
              type="button"
              className={`bl-chip bl-chip--${group}`}
              disabled={disabled}
              onPointerDown={down}
              onPointerMove={(event) => move(event, name)}
              onPointerUp={() => up(name)}
              onPointerCancel={cancel}
              onClick={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  if (event.detail !== 0) return;
                }
                onInsert(name);
              }}
            >
              <Icon size={20} aria-hidden="true" focusable="false" />
              {label}
            </button>
          );
        })}
      </div>
      {dragging && (
        <div className={`bl-ghost bl-chip bl-chip--${BLOCKS[dragging.name].group}`} style={{ left: dragging.x, top: dragging.y }} aria-hidden="true">
          {BLOCKS[dragging.name].label}
        </div>
      )}
    </>
  );
}
