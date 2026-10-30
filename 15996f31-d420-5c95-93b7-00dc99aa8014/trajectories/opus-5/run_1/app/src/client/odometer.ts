import { el, reducedMotion } from './core';

const DIGITS = '0123456789';
const EASE = 'cubic-bezier(0.16, 0.84, 0.32, 1)';

export interface RollTiming {
  /** Milliseconds a column takes to travel one digit. */
  oneDigitMs: number;
  /** Milliseconds the longest travel, through nine digits, takes. */
  nineDigitMs: number;
  /** Milliseconds each column waits behind the column to its right. */
  staggerMs: number;
}

export const AVERAGE_TIMING: RollTiming = { oneDigitMs: 300, nineDigitMs: 800, staggerMs: 40 };
export const MONEY_TIMING: RollTiming = { oneDigitMs: 150, nineDigitMs: 270, staggerMs: 15 };

function travelMs(distance: number, timing: RollTiming): number {
  if (distance <= 1) return timing.oneDigitMs;
  const step = (timing.nineDigitMs - timing.oneDigitMs) / 8;
  return timing.oneDigitMs + (distance - 1) * step;
}

interface Column {
  cell: HTMLElement;
  isDigit: boolean;
}

/**
 * A mechanical counter whose digit columns travel through every intermediate
 * digit. At rest each column holds only its own digit, so the readout reads as
 * the plain figure; the travelling strip exists only while a column moves.
 */
export class Odometer {
  readonly element: HTMLElement;
  private columns: Column[] = [];
  private current = '';
  private settleTimer: number | null = null;

  constructor(className: string, initial: string) {
    this.element = el('span', { class: `odometer ${className}` });
    this.rebuild(initial);
  }

  get text(): string {
    return this.current;
  }

  set dimmed(value: boolean) {
    this.element.classList.toggle('odometer--provisional', value);
  }

  private shapeOf(value: string): string {
    return [...value].map((character) => (DIGITS.includes(character) ? '#' : character)).join('');
  }

  private rebuild(value: string): void {
    this.element.replaceChildren();
    this.columns = [...value].map((character) => {
      const isDigit = DIGITS.includes(character);
      const cell = isDigit
        ? el('span', { class: 'odometer__col' }, [
            el('span', { class: 'odometer__digit', text: character }),
          ])
        : el('span', { class: 'odometer__fixed', text: character });
      this.element.append(cell);
      return { cell, isDigit };
    });
    this.current = value;
  }

  private settleColumn(index: number, digit: string): void {
    const column = this.columns[index];
    if (column === undefined) return;
    column.cell.replaceChildren(el('span', { class: 'odometer__digit', text: digit }));
  }

  /** Moves to the new figure, travelling through every intermediate digit. */
  roll(value: string, timing: RollTiming, onSettled?: () => void): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    if (this.shapeOf(value) !== this.shapeOf(this.current) || reducedMotion()) {
      this.rebuild(value);
      onSettled?.();
      return;
    }
    const previous = this.current;
    const digitIndexes = this.columns
      .map((column, index) => (column.isDigit ? index : -1))
      .filter((index) => index >= 0);
    const moved: number[] = [];
    let longest = 0;
    digitIndexes.forEach((index, position) => {
      const column = this.columns[index] as Column;
      const from = Number(previous[index]);
      const to = Number(value[index]);
      if (from === to) return;
      const delay = (digitIndexes.length - 1 - position) * timing.staggerMs;
      const duration = travelMs(Math.abs(to - from), timing);
      longest = Math.max(longest, delay + duration);
      const strip = el(
        'span',
        { class: 'odometer__strip', 'aria-hidden': 'true' },
        [...DIGITS].map((digit) => el('span', { class: 'odometer__digit', text: digit })),
      );
      strip.style.transform = `translateY(-${from * 10}%)`;
      column.cell.replaceChildren(strip);
      void strip.offsetHeight;
      strip.style.transition = `transform ${duration}ms ${EASE} ${delay}ms`;
      strip.style.transform = `translateY(-${to * 10}%)`;
      moved.push(index);
    });
    this.current = value;
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      for (const index of moved) this.settleColumn(index, value[index] as string);
      onSettled?.();
    }, longest);
  }

  set(value: string): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.rebuild(value);
  }
}
