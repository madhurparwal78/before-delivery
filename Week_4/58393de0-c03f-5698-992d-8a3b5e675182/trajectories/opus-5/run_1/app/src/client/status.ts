import { el } from './dom.js';
import { timers } from './runtime.js';

let region: HTMLElement | null = null;

export const statusRegion = (): HTMLElement => {
  if (!region) {
    region = el('div', {
      id: 'qy-status',
      role: 'status',
      'aria-label': 'Status',
      'aria-live': 'polite',
      class: 'qy-status',
    });
  }
  return region;
};

/** The one polite Status region: up to three lines, newest last. */
export const say = (message: string): void => {
  const host = statusRegion();
  const line = el('p', { class: 'qy-status-line', text: message });
  host.append(line);
  while (host.children.length > 3) host.firstElementChild?.remove();
  window.setTimeout(() => line.remove(), timers().toastMs);
};
