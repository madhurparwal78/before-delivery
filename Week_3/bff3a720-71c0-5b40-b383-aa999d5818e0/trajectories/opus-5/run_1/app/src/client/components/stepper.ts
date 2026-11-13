import { announce } from '../announce.js';
import { h } from '../dom.js';

export interface StepperOptions {
  label: 'Seats' | 'Price per seat' | 'Car seats' | 'Amount in euros';
  min: number;
  max: number;
  step: number;
  pageStep: number;
  value: number;
  format?: (value: number) => string;
  /** The copy announced when a key is pressed at an end of the range. */
  endMessage?: (value: number, end: 'max' | 'min') => string;
  onChange?: (value: number) => void;
  disabled?: boolean;
}

export interface StepperHandle {
  element: HTMLElement;
  value(): number;
  setValue(value: number): void;
  setRange(min: number, max: number): void;
  setDisabled(disabled: boolean): void;
}

export function stepper(options: StepperOptions): StepperHandle {
  let min = options.min;
  let max = options.max;
  let value = Math.min(Math.max(options.value, min), max);

  const element = h('div', {
    role: 'spinbutton',
    'aria-label': options.label,
    tabindex: '0',
    class: 'field stepper',
  });

  const paint = () => {
    const text = options.format ? options.format(value) : String(value);
    element.setAttribute('aria-valuenow', String(value));
    element.setAttribute('aria-valuemin', String(min));
    element.setAttribute('aria-valuemax', String(max));
    element.setAttribute('aria-valuetext', text);
    element.textContent = text;
  };

  const apply = (next: number, pressedKey: boolean) => {
    const clamped = Math.min(Math.max(next, min), max);
    if (clamped === value) {
      if (pressedKey && options.endMessage) {
        if (value >= max) announce(options.endMessage(value, 'max'));
        else if (value <= min) announce(options.endMessage(value, 'min'));
      }
      return;
    }
    value = clamped;
    paint();
    options.onChange?.(value);
  };

  element.addEventListener('keydown', (event) => {
    if (element.getAttribute('aria-disabled') === 'true') return;
    const moves: Record<string, number> = {
      ArrowUp: options.step,
      ArrowDown: -options.step,
      PageUp: options.pageStep,
      PageDown: -options.pageStep,
    };
    if (event.key in moves) {
      event.preventDefault();
      apply(value + (moves[event.key] as number), true);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      apply(min, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      apply(max, true);
    }
  });

  element.addEventListener('click', (event) => {
    if (element.getAttribute('aria-disabled') === 'true') return;
    const box = element.getBoundingClientRect();
    apply(value + (event.clientY < box.top + box.height / 2 ? options.step : -options.step), false);
  });

  paint();
  if (options.disabled) element.setAttribute('aria-disabled', 'true');

  return {
    element,
    value: () => value,
    setValue(next: number) {
      value = Math.min(Math.max(next, min), max);
      paint();
    },
    setRange(nextMin: number, nextMax: number) {
      min = nextMin;
      max = nextMax;
      value = Math.min(Math.max(value, min), max);
      paint();
    },
    setDisabled(disabled: boolean) {
      if (disabled) element.setAttribute('aria-disabled', 'true');
      else element.removeAttribute('aria-disabled');
    },
  };
}

export const seatEndMessage = (value: number, end: 'max' | 'min'): string =>
  end === 'max' ? `Seats: ${value}. This is the most.` : `Seats: ${value}. This is the fewest.`;

export const priceEndMessage =
  (format: (value: number) => string) =>
  (value: number, end: 'max' | 'min'): string =>
    end === 'max'
      ? `Price per seat: ${format(value)}. This is the top of the recommended range.`
      : `Price per seat: ${format(value)}. This is the bottom of the recommended range.`;
