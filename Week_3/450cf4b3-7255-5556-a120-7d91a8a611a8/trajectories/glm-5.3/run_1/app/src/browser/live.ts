// One announcement path into the "Kitchen updates" live region, and the
// recording of which async results are announced.

import { el } from './lib.js';

let live: HTMLElement | null = null;

export function mountLiveRegion(): HTMLElement {
  if (live === null) {
    live = el('div', { id: 'kitchen-updates', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
    document.body.appendChild(live);
  }
  return live;
}

export function announce(text: string): void {
  const region = mountLiveRegion();
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = text;
  });
}
