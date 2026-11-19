// DOM helpers and small building blocks shared by every screen.

import { pageTimeout } from './clock';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string | boolean | null | undefined> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (value === true) node.setAttribute(key, '');
    else if (value !== false) node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function status(name: string): HTMLElement {
  return el('div', { role: 'status', 'aria-live': 'polite', 'data-status': name });
}

export function findStatus(name: string): HTMLElement | null {
  return document.querySelector(`[data-status="${name}"]`);
}

/** Announces a message in a named status region, replacing its text. */
export function announce(name: string, message: string): void {
  const region = findStatus(name);
  if (region) region.textContent = message;
}

/** Announces and clears after 5 s of page time; a newer message restarts the timer. */
const noticeTimers = new Map<string, () => void>();

export function announceExpiring(name: string, message: string): void {
  announce(name, message);
  noticeTimers.get(name)?.();
  const stop = pageTimeout(() => {
    noticeTimers.delete(name);
    const region = findStatus(name);
    if (region && region.textContent === message) region.textContent = '';
  }, 5000);
  noticeTimers.set(name, stop);
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Code point length, so an emoji counts as one. */
export function codePoints(value: string): number {
  return [...value].length;
}

export function query(name: string, url = window.location.href): URLSearchParams {
  return new URL(url).searchParams;
}

/** Replaces the address without adding a history entry. */
export function replaceAddress(path: string): void {
  window.history.replaceState(null, '', path);
}

export function pushAddress(path: string): void {
  window.history.pushState(null, '', path);
}

/** A local path for sign-in return; anything else lands on /dashboard. */
export function safeReturnPath(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return '/dashboard';
  return raw;
}
