import { useId, type ReactElement } from "react";
import { announce } from "../lib/announce";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  pageStep: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Announced when a key would go past the top or the bottom. */
  topNote: string;
  bottomNote: string;
  disabled?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  describedBy?: string;
}

export function Stepper({ label, value, min, max, step, pageStep, format, onChange, topNote, bottomNote, disabled, decreaseLabel, increaseLabel, describedBy }: Props): ReactElement {
  const id = useId();

  const apply = (target: number): void => {
    const clamped = Math.min(max, Math.max(min, target));
    if (clamped !== value) onChange(clamped);
    if (target > max) announce(`${label}: ${format(clamped)}. ${topNote}`);
    else if (target < min) announce(`${label}: ${format(clamped)}. ${bottomNote}`);
  };

  return (
    <div className="stepper">
      <label htmlFor={id}>{label}</label>
      <div className="stepper-row">
        <button type="button" disabled={disabled} aria-label={decreaseLabel} tabIndex={-1} onClick={() => apply(value - step)}>
          −
        </button>
        <input
          id={id}
          type="text"
          role="spinbutton"
          readOnly
          disabled={disabled}
          value={format(value)}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={format(value)}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            const keys: Record<string, () => void> = {
              ArrowUp: () => apply(value + step),
              ArrowDown: () => apply(value - step),
              PageUp: () => apply(value + pageStep),
              PageDown: () => apply(value - pageStep),
              Home: () => apply(min),
              End: () => apply(max),
            };
            const action = keys[event.key];
            if (action) {
              event.preventDefault();
              action();
            }
          }}
        />
        <button type="button" disabled={disabled} aria-label={increaseLabel} tabIndex={-1} onClick={() => apply(value + step)}>
          +
        </button>
      </div>
    </div>
  );
}
