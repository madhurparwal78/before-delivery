import { el, setText } from './dom';
import { anchorServerTime, kitchenClockText, setKitchenTimeZone } from './clock';
import { request } from './api';
import type { KitchenResponse, Me } from '../shared/types';

export interface Screen {
  unmount(): void;
  updateQuery?(query: URLSearchParams): void;
}

export interface ScreenContext {
  root: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
  user: Me | null;
}

let kitchenInfo: KitchenResponse | null = null;

export function kitchen(): KitchenResponse | null {
  return kitchenInfo;
}

export async function loadKitchen(): Promise<void> {
  const result = await request<KitchenResponse>('GET', '/api/kitchen');
  if (result.kind === 'ok') {
    kitchenInfo = result.body;
    setKitchenTimeZone(result.body.timeZone);
    anchorServerTime(result.body.now);
  }
}

let liveRegion: HTMLElement | null = null;

export function registerLiveRegion(node: HTMLElement): void {
  liveRegion = node;
}

/** Writes one message to "Kitchen updates". */
export function announce(text: string): void {
  if (liveRegion === null) return;
  if (liveRegion.textContent === text) {
    liveRegion.textContent = '';
    window.setTimeout(() => {
      if (liveRegion !== null) liveRegion.textContent = text;
    }, 30);
    return;
  }
  liveRegion.textContent = text;
}

export function clearAnnouncements(): void {
  if (liveRegion !== null) liveRegion.textContent = '';
}

type Navigator = (path: string, options?: { replace?: boolean }) => void;

let navigator: Navigator = () => undefined;

export function setNavigator(handler: Navigator): void {
  navigator = handler;
}

export function navigate(path: string, options?: { replace?: boolean }): void {
  navigator(path, options);
}

export function internalLink(text: string, href: string, className = 'link'): HTMLAnchorElement {
  const node = el('a', { text, className, attrs: { href } });
  node.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  });
  return node;
}

export function heading(text: string): HTMLHeadingElement {
  return el('h1', { text, className: 'screen-heading', attrs: { tabindex: '-1' } });
}

export function updateKitchenClock(node: Element): void {
  const text = node.querySelector('.clock-text') ?? node.appendChild(el('span', { className: 'clock-text' }));
  setText(text, kitchenClockText());
}
