import { formatCost } from '../shared/cost.js';
import type { Currency } from '../shared/types.js';
import { cancelTween, tween } from './motion.js';

/**
 * A counting figure: strictly between the old and new value during the count,
 * and the exact final text at the end of the published duration.
 */
export class Figure {
  private current: number;

  constructor(
    private readonly element: HTMLElement | null,
    private readonly format: (value: number) => string,
    initial: number,
  ) {
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  setAtOnce(value: number): void {
    cancelTween(this.key);
    this.current = value;
    this.write(value);
  }

  countTo(value: number, duration: number): void {
    if (duration <= 0 || value === this.current) {
      this.setAtOnce(value);
      return;
    }
    const from = this.current;
    const span = value - from;
    this.current = value;
    tween(this.key, {
      duration,
      apply: (fraction) => {
        if (fraction >= 1) {
          this.write(value);
          return;
        }
        const next = from + span * fraction;
        const clamped =
          span > 0
            ? Math.min(Math.max(next, from + minimumStep(span)), value - minimumStep(span))
            : Math.max(Math.min(next, from - minimumStep(-span)), value + minimumStep(-span));
        this.write(clamped);
      },
    });
  }

  private write(value: number): void {
    if (this.element !== null) this.element.textContent = this.format(value);
  }

  private get key(): string {
    return `figure:${this.element?.getAttribute('data-figure') ?? 'none'}`;
  }
}

/** Keeps every drawn frame strictly inside the span while counting. */
function minimumStep(span: number): number {
  return Math.min(1, Math.abs(span) / 1000);
}

export function costFigure(
  element: HTMLElement | null,
  currency: Currency,
  initial: number,
): Figure {
  return new Figure(element, (value) => formatCost(Math.round(value), currency), initial);
}

export function wholeFigure(element: HTMLElement | null, initial: number): Figure {
  return new Figure(element, (value) => String(Math.round(value)), initial);
}
