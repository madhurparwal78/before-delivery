import { h } from './els.js';
import { announce } from './announce.js';

/**
 * Steppers: Seats steps 1 (or two by Page keys), Price steps 50 cents (€5 by
 * Page keys). Home/End go to the ends; a key at an end announces it.
 */
export interface StepperOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  bigStep: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  endAnnounce: { top: string; bottom: string };
}

export function stepper(opts: StepperOpts): HTMLElement {
  const spin = h('input', {
    class: 'field stepper', type: 'text', role: 'spinbutton', 'aria-label': opts.label,
    'aria-valuemin': String(opts.min), 'aria-valuemax': String(opts.max), 'aria-valuenow': String(opts.value),
    'aria-valuetext': opts.format(opts.value), inputmode: 'numeric',
  }) as HTMLInputElement;
  spin.value = opts.format(opts.value);
  const set = (v: number, announceText?: string): void => {
    const clamped = Math.min(opts.max, Math.max(opts.min, v));
    spin.value = opts.format(clamped);
    spin.setAttribute('aria-valuenow', String(clamped));
    spin.setAttribute('aria-valuetext', opts.format(clamped));
    opts.onChange(clamped);
    if (announceText) announce(announceText);
  };
  spin.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    let delta = 0;
    if (ke.key === 'ArrowUp') delta = opts.step;
    else if (ke.key === 'ArrowDown') delta = -opts.step;
    else if (ke.key === 'PageUp') delta = opts.bigStep;
    else if (ke.key === 'PageDown') delta = -opts.bigStep;
    else if (ke.key === 'Home') { ke.preventDefault(); set(opts.min); return; }
    else if (ke.key === 'End') { ke.preventDefault(); set(opts.max); return; }
    else return;
    ke.preventDefault();
    const next = Number(spin.getAttribute('aria-valuenow')) + delta;
    if (next > opts.max) { announce(opts.endAnnounce.top.replace('<n>', opts.format(opts.max))); return; }
    if (next < opts.min) { announce(opts.endAnnounce.bottom.replace('<n>', opts.format(opts.min))); return; }
    set(next);
  });
  const wrap = h('div', { class: 'stepper-wrap' }, spin);
  return wrap;
}

export function seatsStepper(value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
  return stepper({
    label: 'Seats', min, max, step: 1, bigStep: 2, value,
    format: v => String(v),
    onChange,
    endAnnounce: { top: `Seats: <n>. This is the most.`, bottom: `Seats: <n>. This is the fewest.` },
  });
}

export function priceStepper(value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
  const fmt = (v: number): string => `€${(v / 100).toFixed(2)}`;
  return stepper({
    label: 'Price per seat', min, max, step: 50, bigStep: 500, value,
    format: fmt,
    onChange,
    endAnnounce: { top: `Price per seat: <n>. This is the top of the recommended range.`, bottom: `Price per seat: <n>. This is the bottom of the recommended range.` },
  });
}
