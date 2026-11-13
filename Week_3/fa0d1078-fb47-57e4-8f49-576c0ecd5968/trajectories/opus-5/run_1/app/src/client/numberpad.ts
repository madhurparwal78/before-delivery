import { DIGITS, type Digit } from '../shared/board';
import { apply, button, el } from './dom';

/** The on-screen pad: each digit shows how many of it are still to place. */
export class NumberPad {
  readonly element: HTMLElement;

  private readonly buttons = new Map<Digit, HTMLButtonElement>();

  constructor(onDigit: (digit: Digit) => void) {
    this.element = el('div', { role: 'group', 'aria-label': 'Number pad', class: 'number-pad' });
    for (const digit of DIGITS) {
      const control = button(String(digit), {
        'aria-label': `Digit ${digit}`,
        class: 'pad-digit',
        'data-remaining': '9',
      });
      control.addEventListener('click', () => onDigit(digit));
      this.buttons.set(digit, control);
      this.element.append(control);
    }
  }

  setRemaining(remaining: (digit: Digit) => number): void {
    for (const digit of DIGITS) {
      const control = this.buttons.get(digit) as HTMLButtonElement;
      const left = remaining(digit);
      apply(control, { 'data-remaining': String(left) });
      control.disabled = left === 0;
    }
  }
}
