import { el } from './dom.js';

let statusRegion: HTMLElement | null = null;
let alertRegion: HTMLElement | null = null;

/** The two live regions every app page carries. */
export function liveRegions(): HTMLElement {
  statusRegion = el('div', {
    role: 'status',
    'aria-label': 'Announcements',
    'aria-live': 'polite',
    class: 'live-region'
  });
  alertRegion = el('div', {
    role: 'alert',
    'aria-label': 'Problems',
    class: 'live-region'
  });
  return el('div', { class: 'live-regions' }, [statusRegion, alertRegion]);
}

export function announce(message: string): void {
  if (statusRegion === null) return;
  statusRegion.textContent = '';
  window.setTimeout(() => {
    if (statusRegion !== null) statusRegion.textContent = message;
  }, 10);
}

export function alertNow(message: string): void {
  if (alertRegion === null) return;
  alertRegion.textContent = '';
  window.setTimeout(() => {
    if (alertRegion !== null) alertRegion.textContent = message;
  }, 10);
}

/** True when the person's system asks for reduced motion. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTouch(): boolean {
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}
