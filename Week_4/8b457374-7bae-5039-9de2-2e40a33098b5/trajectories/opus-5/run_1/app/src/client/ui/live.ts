import { el, type Child } from '../dom.js';

/** A named polite live region, the only place results are announced. */
export function statusRegion(name: string, className = 'live'): HTMLElement {
  return el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    'aria-label': name,
    class: className,
  });
}

export function announce(region: HTMLElement, ...children: Child[]): void {
  region.replaceChildren();
  for (const child of children) {
    if (!(child instanceof Node)) continue;
    region.appendChild(child);
  }
}

export function announceText(region: HTMLElement, text: string): void {
  announce(region, el('p', { class: 'live-line' }, text));
}
