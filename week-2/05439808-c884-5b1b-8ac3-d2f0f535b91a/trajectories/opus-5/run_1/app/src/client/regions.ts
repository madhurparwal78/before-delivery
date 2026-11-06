import { el } from './dom.js';

let notices: HTMLElement | null = null;
let alerts: HTMLElement | null = null;
let banner: HTMLElement | null = null;

export function mountRegions(root: HTMLElement): void {
  notices = el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Tide notices',
    class: 'live-region notices'
  });
  alerts = el('p', {
    role: 'alert',
    'aria-live': 'assertive',
    'aria-label': 'Tide alerts',
    class: 'live-region alerts'
  });
  banner = el('p', { class: 'outage-banner', hidden: true });
  root.append(notices, alerts, banner);
}

export function notice(message: string): void {
  if (notices) notices.textContent = message;
}

export function alertNotice(message: string): void {
  if (alerts) alerts.textContent = message;
}

export function showOutageBanner(message: string | null): void {
  if (!banner) return;
  if (message === null) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}
