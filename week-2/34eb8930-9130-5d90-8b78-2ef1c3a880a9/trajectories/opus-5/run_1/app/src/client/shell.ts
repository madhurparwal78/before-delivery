import { clear, el } from './dom.js';

let announcements: HTMLElement | null = null;
let bannerHost: HTMLElement | null = null;
const banners = new Map<string, HTMLElement>();

function ensureRegions(): { live: HTMLElement; host: HTMLElement } {
  if (!announcements) {
    announcements = el('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', class: 'visually-hidden' });
    document.body.appendChild(announcements);
  }
  if (!bannerHost) {
    bannerHost = el('div', { class: 'banners' });
    document.body.appendChild(bannerHost);
  }
  return { live: announcements, host: bannerHost };
}

/** One announcement per event in the Announcements region. */
export function announce(text: string): void {
  const { live } = ensureRegions();
  live.textContent = text;
}

export function showBanner(key: string, text: string): void {
  const { host } = ensureRegions();
  const existing = banners.get(key);
  if (existing) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const banner = el('div', { role: 'alert', class: 'banner', text });
  host.appendChild(banner);
  banners.set(key, banner);
}

export function hideBanner(key: string): void {
  const banner = banners.get(key);
  if (!banner) return;
  banner.remove();
  banners.delete(key);
}

export function clearBanners(): void {
  for (const key of [...banners.keys()]) hideBanner(key);
}

export function root(): HTMLElement {
  const node = document.getElementById('root');
  if (!node) throw new Error('missing root');
  return node;
}

export function renderInto(content: HTMLElement): void {
  const host = root();
  clear(host);
  host.appendChild(content);
}

type Navigate = (path: string, options?: { replace?: boolean }) => void;
let navigator: Navigate = () => undefined;

export function setNavigator(next: Navigate): void {
  navigator = next;
}

export function navigate(path: string, options?: { replace?: boolean }): void {
  navigator(path, options);
}
