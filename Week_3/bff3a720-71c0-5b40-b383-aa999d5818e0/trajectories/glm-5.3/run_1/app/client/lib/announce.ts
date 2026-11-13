import { h } from './els.js';
import { store } from './store.js';

/** The one polite live region of the page. */
export function announce(message: string): void {
  const region = document.getElementById('announcements');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => { region.textContent = message; }, 10);
}

export function announcementsRegion(): HTMLElement {
  return h('div', { id: 'announcements', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
}

export function notificationsRegion(): HTMLElement {
  return h('div', { id: 'notifications', role: 'region', 'aria-label': 'Notifications', class: 'toasts' });
}

export interface ToastHandle { remove: () => void }

export function toast(message: string, action?: { label: string; onClick: () => void }): ToastHandle {
  const region = document.getElementById('notifications');
  if (!region) return { remove: () => undefined };
  const t = h('div', { class: 'toast', 'data-motion': 'toast', 'data-motion-ms': motionMs(200), 'data-state': 'running' },
    h('span', null, message),
    action ? h('button', { class: 'toast-action', type: 'button', onClick: () => { action.onClick(); t.remove(); } }, action.label) : null,
  );
  region.append(t);
  window.setTimeout(() => {
    t.setAttribute('data-state', 'done');
    t.remove();
  }, store.config.toastSeconds * 1000);
  return { remove: () => t.remove() };
}

export function motionMs(ms: number): string {
  return reducedMotion() ? '0' : String(ms);
}

export function reducedMotion(): boolean {
  return document.documentElement.dataset.motionPref === 'reduced';
}

export function motionAttrs(name: string, ms: number): Record<string, string> {
  return { 'data-motion': name, 'data-motion-ms': motionMs(ms), 'data-state': 'running' };
}
