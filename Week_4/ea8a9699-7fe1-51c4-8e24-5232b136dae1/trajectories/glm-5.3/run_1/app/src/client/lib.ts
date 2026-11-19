// The client's shared state and helpers: session, API calls, router, DOM.

import type { Account, ApiError } from '../shared/types.js';

export interface Session {
  account: Account;
}

let currentSession: Session | null = null;

export async function api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null; error: ApiError | null; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  let error: ApiError | null = null;
  try {
    const parsed = JSON.parse(text);
    if (res.ok) data = parsed as T;
    else error = parsed as ApiError;
  } catch {
    if (!res.ok) error = { error: 'unknown', message: 'Something went wrong.' };
  }
  if (res.status === 401) {
    currentSession = null;
  }
  return { ok: res.ok, status: res.status, data: data as T | null, error, headers: res.headers };
}

export async function loadSession(): Promise<Session | null> {
  const r = await api<Account>('GET', '/api/me');
  if (r.data) {
    currentSession = { account: r.data };
  }
  return currentSession;
}

export function session(): Session | null {
  return currentSession;
}

export function setSession(s: Session | null): void {
  currentSession = s;
}

export function signOut(): Promise<void> {
  currentSession = null;
  return api('POST', '/api/auth/signout').then(() => undefined);
}

// --- Router -------------------------------------------------------------

type RouteEntry = { regex: RegExp; render: (m: RegExpMatchArray, params: URLSearchParams) => Promise<Node> };
const routes: RouteEntry[] = [];

export function route(pattern: string, render: (m: RegExpMatchArray, params: URLSearchParams) => Promise<Node>): void {
  const regex = new RegExp(`^${pattern}/?$`);
  routes.push({ regex, render });
}

export async function renderPath(pathname: string, params: URLSearchParams): Promise<Node> {
  for (const r of routes) {
    const m = pathname.match(r.regex);
    if (m) {
      return r.render(m, params);
    }
  }
  return notFoundPage();
}

// --- DOM helpers --------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v as EventListener);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function link(href: string, text: string, cls?: string): HTMLAnchorElement {
  const a = el('a', { href, class: cls });
  a.textContent = text;
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState(null, '', href);
    void mountApp();
  });
  return a;
}

// --- Live regions -------------------------------------------------------

function live(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found) return found;
  const div = el('div', { id, role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  document.body.append(div);
  return div;
}

export function announce(id: string, message: string): void {
  const region = live(id);
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

export async function mountApp(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const url = new URL(window.location.href);
  if (!currentSession) {
    await loadSession();
  }
  app.replaceChildren();
  const node = await renderPath(url.pathname, url.searchParams);
  app.append(node);
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  void mountApp();
}

export function notFoundPage(): HTMLElement {
  return el('main', { class: 'page-narrow' },
    el('section', { class: 'panel not-found', 'aria-labelledby': 'nf-h' },
      el('h1', { id: 'nf-h' }, 'This page does not exist.')),
  );
}
