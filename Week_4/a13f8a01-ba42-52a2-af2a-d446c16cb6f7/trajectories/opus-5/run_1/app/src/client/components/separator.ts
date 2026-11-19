import { h } from '../dom';

export const SEPARATOR_MIN = 15;
export const SEPARATOR_MAX = 85;

export interface Separator {
  element: HTMLElement;
  value: () => number;
  set: (value: number) => void;
  setOrientation: (orientation: 'vertical' | 'horizontal') => void;
}

export interface SeparatorOptions {
  label: string;
  initial: number;
  /** Turns a pointer position into the leading neighbour's share, or null while not draggable. */
  share: (event: PointerEvent) => number | null;
  onChange: (value: number) => void;
}

const clamp = (value: number): number =>
  Math.min(SEPARATOR_MAX, Math.max(SEPARATOR_MIN, Math.round(value)));

/** Keys act on aria-valuenow: arrows step by 5, Home is 15 and End is 85, clamped at the ends. */
export const separator = (options: SeparatorOptions): Separator => {
  let value = clamp(options.initial);
  const element = h('div', {
    role: 'separator',
    'aria-label': options.label,
    tabindex: '0',
    'aria-orientation': 'vertical',
    'aria-valuemin': String(SEPARATOR_MIN),
    'aria-valuemax': String(SEPARATOR_MAX),
    'aria-valuenow': String(value),
    class: 'separator',
  });

  const set = (next: number): void => {
    value = clamp(next);
    element.setAttribute('aria-valuenow', String(value));
    options.onChange(value);
  };

  element.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') set(value - 5);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') set(value + 5);
    else if (event.key === 'Home') set(SEPARATOR_MIN);
    else if (event.key === 'End') set(SEPARATOR_MAX);
    else return;
    event.preventDefault();
  });

  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  element.addEventListener('pointermove', (event) => {
    if (!element.hasPointerCapture(event.pointerId)) return;
    const share = options.share(event);
    if (share !== null) set(share);
  });
  element.addEventListener('pointerup', (event) => element.releasePointerCapture(event.pointerId));

  return {
    element,
    value: () => value,
    set,
    setOrientation: (orientation) => element.setAttribute('aria-orientation', orientation),
  };
};
