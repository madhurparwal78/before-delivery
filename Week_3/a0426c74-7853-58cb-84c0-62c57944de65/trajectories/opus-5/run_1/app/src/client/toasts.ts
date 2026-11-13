import { el, reducedMotion } from './dom.js';
import { settings } from './api.js';

let stack: HTMLElement | null = null;
let announcer: HTMLElement | null = null;

export function toastStack(): HTMLElement {
  if (!stack) {
    stack = el('div', { class: 'toasts', role: 'status', 'aria-label': 'Notices', 'aria-live': 'polite' });
  }
  return stack;
}

export function announcerRegion(): HTMLElement {
  if (!announcer) {
    announcer = el('div', {
      class: 'visually-hidden',
      role: 'status',
      'aria-label': 'Drawing announcements',
      'aria-live': 'polite',
    });
  }
  return announcer;
}

export function toast(text: string): void {
  const host = toastStack();
  const node = el('p', { class: 'toast' }, [text]);
  host.append(node);
  if (!reducedMotion()) {
    node.animate(
      [
        { opacity: 0, transform: 'translateY(-4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 120, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', id: 'toast-enter' },
    );
  }
  window.setTimeout(() => node.remove(), settings().toastMs);
}

export function announce(text: string): void {
  const region = announcerRegion();
  region.textContent = text;
}
