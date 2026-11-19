import type { PublicConfig, UserRef } from '../shared/types.js';
import { relativeTime } from '../shared/time.js';

export const state: {
  config: PublicConfig;
  user: (UserRef & { email: string }) | null;
  clockBase: number;
  clockReal: number;
} = {
  config: {
    now: new Date().toISOString(),
    time_zone: 'UTC',
    undo_seconds: 30,
    invite_ttl_seconds: 604800,
    limits: {
      image_max_bytes: 10000000,
      image_max_pixels: 40000000,
      title_max: 100,
      description_max: 500,
      comment_max: 500,
      board_name_max: 50,
    },
  },
  user: null,
  clockBase: Date.now(),
  clockReal: Date.now(),
};

/** The browser counts on from the last business now the server sent. */
export function businessNow(): Date {
  return new Date(state.clockBase + (Date.now() - state.clockReal));
}

export function setBusinessNow(instant: string): void {
  state.clockBase = new Date(instant).getTime();
  state.clockReal = Date.now();
  renderTimes();
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'error');
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return typeof this.body.error === 'string' ? this.body.error : 'error';
  }

  get field(): string | null {
    return typeof this.body.field === 'string' ? this.body.field : null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    throw new ApiFailure(response.status, payload as Record<string, unknown>);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

let announcer: HTMLElement | null = null;
let notices: HTMLElement | null = null;
let alertRegion: HTMLElement | null = null;

export function registerRegions(
  politeRegion: HTMLElement,
  noticeRegion: HTMLElement,
  errorRegion: HTMLElement,
): void {
  announcer = politeRegion;
  notices = noticeRegion;
  alertRegion = errorRegion;
}

export function announce(message: string): void {
  if (!announcer) return;
  announcer.textContent = '';
  window.setTimeout(() => {
    if (announcer) announcer.textContent = message;
  }, 20);
}

export function showAlert(message: string): void {
  if (!alertRegion) return;
  clear(alertRegion);
  alertRegion.append(el('p', { class: 'alert-line', text: message }));
}

export function clearAlert(): void {
  if (alertRegion) clear(alertRegion);
}

export interface ToastOptions {
  undo?: { deadline: string; run: () => void | Promise<void> };
  keep?: boolean;
}

export interface ToastHandle {
  element: HTMLElement;
  remove(): void;
}

const undoToasts = new Map<number, ToastHandle>();

export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const node = el('div', { class: 'toast' });
  node.append(el('span', { text: message }));
  const handle: ToastHandle = {
    element: node,
    remove: () => {
      if (reducedMotion()) {
        node.remove();
        return;
      }
      node.classList.add('leaving');
      window.setTimeout(() => node.remove(), 420);
    },
  };
  if (options.undo) {
    node.setAttribute('data-deadline', options.undo.deadline);
    const button = el('button', { type: 'button', class: 'undo', text: 'Undo' });
    button.addEventListener('click', () => {
      void options.undo?.run();
    });
    node.append(document.createTextNode(' · '), button);
  }
  notices?.append(node);
  if (!reducedMotion()) {
    node.classList.add('entering');
    window.requestAnimationFrame(() => node.classList.remove('entering'));
  }
  if (!options.undo && options.keep !== true) {
    window.setTimeout(() => handle.remove(), 6000);
  }
  return handle;
}

export function registerUndoToast(operationId: number, handle: ToastHandle): void {
  undoToasts.set(operationId, handle);
}

export function closeUndoToast(operationId: number): void {
  const handle = undoToasts.get(operationId);
  if (handle) {
    handle.remove();
    undoToasts.delete(operationId);
  }
}

export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === 'reduced';
}

export function failureMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    switch (error.code) {
      case 'storage_unavailable':
        return "Images can't be uploaded right now. Your draft is kept.";
      default:
        return 'Something went wrong. Try again.';
    }
  }
  return 'Something went wrong. Try again.';
}

const timeNodes = new Set<HTMLTimeElement>();

export function timeElement(instant: string): HTMLTimeElement {
  const node = el('time', { datetime: instant });
  node.textContent = relativeTime(new Date(instant), businessNow(), state.config.time_zone);
  timeNodes.add(node);
  return node;
}

export function renderTimes(): void {
  const now = businessNow();
  for (const node of [...timeNodes]) {
    if (!node.isConnected) {
      timeNodes.delete(node);
      continue;
    }
    const instant = node.getAttribute('datetime');
    if (instant) node.textContent = relativeTime(new Date(instant), now, state.config.time_zone);
  }
}

window.setInterval(renderTimes, 1000);

export function busy<T>(button: HTMLButtonElement, label: string, run: () => Promise<T>): Promise<T> {
  const previous = button.textContent ?? '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  return run().finally(() => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = previous;
  });
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
