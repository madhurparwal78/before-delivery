import { formatCost, formatCount } from '../shared/cost';
import type { Currency } from '../shared/types';
import { animate, easeOut } from './frame-loop';
import { reducedMotion } from './dom';

type Format = (value: number) => string;

export const costFormat = (currency: Currency): Format => (value) => formatCost(value, currency);
export const countFormat: Format = (value) => formatCount(value);

/** A number shown in a `data-figure` element that counts to a new value on page time, and is final at once under reduced motion. */
export class Figure {
  private shown: number;
  private cancel: (() => void) | null = null;

  constructor(readonly element: HTMLElement, private readonly format: Format, name: string, initial = 0) {
    element.dataset.figure = name;
    this.shown = initial;
    element.textContent = format(initial);
  }

  /** Sets the figure outright. */
  set(value: number): void {
    this.cancel?.();
    this.cancel = null;
    this.shown = value;
    this.element.textContent = this.format(value);
  }

  /** Counts from what is shown to `value` over `duration` ms; values in between are strictly between old and new. */
  countTo(value: number, duration: number): void {
    this.cancel?.();
    if (reducedMotion() || duration === 0 || value === this.shown) return this.set(value);
    const from = this.shown;
    this.cancel = animate(duration, (progress) => {
      this.shown = progress >= 1 ? value : Math.round(from + (value - from) * easeOut(progress));
      this.element.textContent = this.format(this.shown);
    }, (t) => t);
  }
}
