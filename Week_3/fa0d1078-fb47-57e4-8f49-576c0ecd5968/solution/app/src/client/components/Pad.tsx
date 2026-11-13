import type { JSX } from "preact";
import { DIGITS, type Digit } from "../../shared/board";
import { remaining, type CellView } from "../game/view";

interface PadProps {
  cells: readonly CellView[];
  onDigit: (digit: Digit) => void;
}

export function Pad({ cells, onDigit }: PadProps): JSX.Element {
  return (
    <div class="pad" role="group" aria-label="Number pad">
      {DIGITS.map((digit) => {
        const left = remaining(cells, digit);
        return (
          <button type="button" key={digit} class="pad-key" aria-label={`Digit ${digit}`} data-remaining={left} disabled={left === 0} onClick={() => onDigit(digit)}>
            {digit}
          </button>
        );
      })}
    </div>
  );
}
