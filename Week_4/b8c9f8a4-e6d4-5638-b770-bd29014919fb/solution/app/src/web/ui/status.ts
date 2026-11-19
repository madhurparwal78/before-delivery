// Live regions. Every write replaces the region's text node, so a message identical to the one
// already there is announced again, and steps that follow each other arrive as separate updates.

import { el } from '../dom.js';

export function statusRegion(name: string, extra = ''): HTMLElement {
  return el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': name,
    class: `status ${extra}`.trim(),
  });
}

export function alertRegion(name = 'Service notice'): HTMLElement {
  return el('p', { role: 'alert', 'aria-label': name, class: 'notice-panel', hidden: true });
}

export function announce(region: HTMLElement | null, text: string): void {
  if (!region) return;
  region.replaceChildren(document.createTextNode(text));
  region.hidden = false;
}

/** Writes each step as its own update, so each one is announced in turn. */
export async function announceSteps(region: HTMLElement | null, steps: string[]): Promise<void> {
  for (const step of steps) {
    announce(region, step);
    await Promise.resolve();
    await Promise.resolve();
  }
}
