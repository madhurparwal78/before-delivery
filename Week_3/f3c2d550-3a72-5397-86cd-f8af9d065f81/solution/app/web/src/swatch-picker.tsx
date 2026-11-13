import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useField, type Marker } from "./field";

interface SwatchPickerProps {
  /** Whether eyedropper mode is open; the screen shows the whole photo in the tile while it is. */
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onSample: (point: Marker) => void;
  /** A point already chosen, kept as a quiet marker on the tile. */
  chosen?: Marker | null;
  disabled?: boolean;
  error?: string | undefined;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function SwatchPicker({ active, onActiveChange, onSample, chosen = null, disabled = false, error }: SwatchPickerProps) {
  const field = useField();
  const [point, setPoint] = useState<Marker>({ x: 0.5, y: 0.5 });
  const pickButton = useRef<HTMLButtonElement>(null);
  const crosshair = useRef<HTMLButtonElement>(null);
  const sampleRef = useRef(onSample);
  sampleRef.current = onSample;

  const finish = (sample: Marker | null) => {
    onActiveChange(false);
    pickButton.current?.focus();
    if (sample) sampleRef.current(sample);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (!active) {
      field.setPicker(chosen ? { marker: chosen, onPick: null } : null);
      return;
    }
    field.setPicker({ marker: point, onPick: (x, y) => finishRef.current({ x, y }) });
  }, [active, point, chosen, field]);

  useEffect(() => {
    if (!active) return;
    setPoint({ x: 0.5, y: 0.5 });
    crosshair.current?.focus();
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") finishRef.current(null);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [active]);

  useEffect(() => () => field.setPicker(null), [field]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setPoint((previous) => ({ x: clamp(previous.x + move[0]), y: clamp(previous.y + move[1]) }));
  };

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="swatch-picker">
      <button
        ref={pickButton}
        id="f-swatch"
        type="button"
        className="btn"
        aria-disabled={disabled || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "f-swatch-error" : undefined}
        onClick={() => {
          if (!disabled) onActiveChange(true);
        }}
      >
        Pick swatch
      </button>
      {error && (
        <p id="f-swatch-error" className="field-error">
          {error}
        </p>
      )}
      {active && (
        <div role="group" aria-label="Eyedropper" className="eyedropper">
          <button
            ref={crosshair}
            type="button"
            className="btn crosshair-control"
            aria-label={`Crosshair, ${percent(point.x)} across and ${percent(point.y)} down the photograph`}
            onKeyDown={onKeyDown}
            onClick={() => finish(point)}
          >
            {percent(point.x)}, {percent(point.y)}
          </button>
          <button type="button" className="btn" onClick={() => finish(point)}>
            Use this colour
          </button>
          <button type="button" className="btn" onClick={() => finish(null)}>
            Cancel eyedropper
          </button>
        </div>
      )}
    </div>
  );
}
