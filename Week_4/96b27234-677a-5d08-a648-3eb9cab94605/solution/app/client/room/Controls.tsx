import { useEffect, useRef } from "react";
import { DIRECTIONS, type Direction } from "../../shared/protocol";
import { Icon } from "../ui/Icon";

const HOLD_MS = 250;

/**
 * Four direction buttons and Sit or stand. A press steps once at once; holding repeats every 250 ms of page
 * clock until release, even when the pointer is released outside the button. Keyboard activation steps once.
 */
export function Controls({ onStep, onSit }: { onStep: (direction: Direction) => void; onSit: () => void }) {
  const repeat = useRef(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const press = (direction: Direction): void => {
    stop.current?.();
    onStep(direction);
    repeat.current = window.setInterval(() => onStep(direction), HOLD_MS);
    const release = (): void => {
      window.clearInterval(repeat.current);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      stop.current = null;
    };
    stop.current = release;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  return (
    <div className="dpad">
      {DIRECTIONS.map((direction) => (
        <button
          key={direction}
          type="button"
          className={`button dpad-${direction}`}
          aria-label={`Step ${direction}`}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            press(direction);
          }}
          onClick={(event) => {
            if (event.detail === 0) onStep(direction);
          }}
        >
          <Icon name={direction} size={24} />
        </button>
      ))}
      <button type="button" className="button dpad-sit" aria-label="Sit or stand" onClick={onSit}>
        <Icon name="sit" size={22} /> <span>Sit or stand</span>
      </button>
    </div>
  );
}
