/**
 * The api client and the toast/notice plumbing.
 */

import { el } from './dom.js';

export interface ApiOut<T> {
  status: number;
  body: T | { error: string; message: string; fields?: Record<string, string>; lines?: string[] };
  ok: boolean;
}

export async function api<T>(path: string, method = 'GET', body?: unknown, raw?: ArrayBuffer | null, contentType?: string): Promise<ApiOut<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (contentType) headers['content-type'] = contentType;
  const res = await fetch(path, {
    method,
    headers,
    body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const parsed = isJson ? await res.json() : await res.text();
  return { status: res.status, body: parsed as T, ok: res.ok };
}

export function errorOf(out: ApiOut<unknown>): { code: string; message: string; fields?: Record<string, string>; lines?: string[] } {
  const b = out.body as { error?: string; message?: string; fields?: Record<string, string>; lines?: string[] };
  return { code: b?.error ?? 'unknown', message: b?.message ?? '', fields: b?.fields, lines: b?.lines };
}

let toastMs = 5000;
export function setToastMs(ms: number): void { toastMs = ms; }

let noticeRegion: HTMLElement | null = null;

export function initNotices(): void {
  noticeRegion = el('div', { class: 'notices', role: 'region', 'aria-label': 'Notices' });
  document.body.appendChild(noticeRegion);
}

/** Show a toast for the toast lifetime on page timers. */
export function toast(text: string): void {
  if (!noticeRegion) initNotices();
  const node = el('div', { class: 'toast' }, text);
  noticeRegion!.appendChild(node);
  node.animate([{ opacity: 0 }, { opacity: 1 }], { id: 'toast-enter', duration: 120, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' });
  setTimeout(() => {
    node.remove();
  }, toastMs);
}
