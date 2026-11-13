import type { AvailabilityRecord } from '../../shared/types.js';
import { availabilityCopy } from '../copy.js';
import { api, Offline } from '../data/api.js';
import { state } from '../data/store.js';
import { el } from './dom.js';
import { reducedMotion } from './motion.js';

export interface AvailabilityChip {
  element: HTMLElement;
  /** Runs the published debounce after the last keystroke. */
  check: (value: string) => void;
  last: () => AvailabilityRecord | null;
}

export function availabilityChip(): AvailabilityChip {
  const element = el('p', {
    class: 'chip',
    attrs: { role: 'status', 'aria-label': 'Username availability', tabindex: '0' },
  });
  let timer: number | null = null;
  let latest: AvailabilityRecord | null = null;
  let pending = '';

  function show(text: string): void {
    element.textContent = text;
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reducedMotion() ? 120 : 160,
      fill: 'both',
    });
  }

  return {
    element,
    last: () => latest,
    check: (value: string) => {
      pending = value;
      if (timer !== null) window.clearTimeout(timer);
      if (value === '') {
        latest = null;
        element.textContent = '';
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        void api
          .availability(pending)
          .then((record) => {
            latest = record;
            show(availabilityCopy(record.reason, record.available));
          })
          .catch((error: unknown) => {
            if (error instanceof Offline) return;
            throw error;
          });
      }, state.config.timers.availability_debounce_ms);
    },
  };
}
