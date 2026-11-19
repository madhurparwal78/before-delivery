import { el } from './dom.js';

import { settings } from './state.js';

const regions = new Map<string, HTMLElement>();

export function statusRegion(name: string, assertive = false): HTMLElement {
  const existing = regions.get(name);
  if (existing && existing.isConnected) return existing;
  const node = el('div', {
    role: 'status',
    'aria-label': name,
    'aria-live': assertive ? 'assertive' : 'polite',
    'aria-atomic': 'true',
    class: 'status-region',
  });
  regions.set(name, node);
  return node;
}

/** A message an action just showed is never overwritten by the repaint that follows. */
export function announce(name: string, message: string): void {
  const node = regions.get(name);
  if (!node) return;
  node.textContent = message;
}

let toastHost: HTMLElement | null = null;

export function toastContainer(): HTMLElement {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', {
      role: 'status',
      'aria-label': 'Notifications',
      'aria-live': 'polite',
      'aria-atomic': 'false',
      class: 'toast-host',
    });
  }
  return toastHost;
}

export function toast(message: string): void {
  const host = toastContainer();
  const node = el('p', { class: 'toast' }, message);
  host.appendChild(node);
  setTimeout(() => node.remove(), settings.toastMs);
}
