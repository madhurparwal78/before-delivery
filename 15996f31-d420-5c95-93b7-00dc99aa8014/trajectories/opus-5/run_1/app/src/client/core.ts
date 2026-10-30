import type { ApiErrorBody } from '../shared/api-types';

export type Attributes = Record<string, string | number | boolean | null>;

/** Builds an element with attributes and children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: ReadonlyArray<Node | string> | string = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  const list = typeof children === 'string' ? [children] : children;
  for (const child of list) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;
  readonly remaining: number | null;
  readonly offline: boolean;

  constructor(status: number, body: ApiErrorBody | null, offline = false) {
    super(body?.message ?? 'Request failed');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body?.error ?? 'network_error';
    this.fields = body?.fields ?? null;
    this.remaining = body?.remaining ?? null;
    this.offline = offline;
  }
}

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
}

export async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (options.form !== undefined) {
    payload = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: payload }),
    });
  } catch {
    throw new ApiFailure(0, null, true);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length === 0 ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

const GENERIC_COPY: Record<string, string> = {
  offline: "Bloom Desk can't reach its server. Check your connection and try again.",
  expired: 'Your session has ended. Sign in again.',
  missing: "That record isn't available to you.",
  reused: 'That request was already sent with different details. Reload and try again.',
  server: 'Something went wrong on our side. Try again in a minute.',
};

/** The copy for a refusal that an action does not spell out itself. */
export function genericFailureCopy(failure: ApiFailure): string {
  if (failure.offline) return GENERIC_COPY.offline as string;
  if (failure.status === 401) return GENERIC_COPY.expired as string;
  if (failure.status === 404) return GENERIC_COPY.missing as string;
  if (failure.code === 'idempotency_key_reused') return GENERIC_COPY.reused as string;
  if (failure.status === 409) return failure.message;
  if (failure.status === 422 && failure.fields !== null) {
    return Object.values(failure.fields).join(' ');
  }
  if (failure.status >= 500) return GENERIC_COPY.server as string;
  return failure.message;
}

export interface LiveRegions {
  updates: HTMLElement;
  problems: HTMLElement;
  strength: HTMLElement;
  changes: HTMLElement;
}

let regions: LiveRegions | null = null;

export function mountLiveRegions(host: HTMLElement): LiveRegions {
  const updates = el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Desk updates',
    class: 'live live--updates',
  });
  const problems = el('p', {
    role: 'alert',
    'aria-live': 'assertive',
    'aria-label': 'Desk problems',
    class: 'live live--problems',
  });
  const strength = el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Strength readout',
    class: 'live live--strength',
  });
  const changes = el('div', {
    role: 'log',
    'aria-live': 'polite',
    'aria-label': 'Strength changes',
    class: 'live live--changes',
    hidden: true,
  });
  host.append(updates, problems, strength, changes);
  regions = { updates, problems, strength, changes };
  return regions;
}

function liveRegions(): LiveRegions {
  return regions as LiveRegions;
}

export function announceUpdate(message: string): void {
  liveRegions().updates.textContent = message;
}

export function announceProblem(message: string): void {
  liveRegions().problems.textContent = message;
}

export function clearProblem(): void {
  liveRegions().problems.textContent = '';
}

export function announceStrength(message: string): void {
  liveRegions().strength.textContent = message;
}

export function logStrengthChange(message: string): void {
  const log = liveRegions().changes;
  log.hidden = false;
  log.append(el('p', { class: 'change-note', text: message }));
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Marks a button busy with the progress dots, or "Working…" with reduced motion. */
export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  if (busy) {
    button.dataset.label = button.dataset.label ?? button.textContent ?? '';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    clear(button);
    if (reducedMotion()) {
      button.append(el('span', { class: 'button__working', text: 'Working…' }));
    } else {
      const dots = el('span', { class: 'button__dots', 'aria-hidden': 'true' }, [
        el('i', {}),
        el('i', {}),
        el('i', {}),
      ]);
      button.append(dots);
    }
    return;
  }
  button.disabled = false;
  button.removeAttribute('aria-busy');
  clear(button);
  button.append(document.createTextNode(button.dataset.label ?? ''));
}

export interface ActionRun<T> {
  button: HTMLButtonElement;
  pending: string;
  run: () => Promise<T>;
  success: (result: T) => string;
  refusal?: (failure: ApiFailure) => string | null;
  onFailure?: (failure: ApiFailure) => void;
}

/** Runs one async action with its pending, success and refusal announcements. */
export async function runAction<T>(action: ActionRun<T>): Promise<T | null> {
  setBusy(action.button, true);
  clearProblem();
  announceUpdate(action.pending);
  try {
    const result = await action.run();
    announceUpdate(action.success(result));
    return result;
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : new ApiFailure(0, null, true);
    announceUpdate('');
    const copy = action.refusal?.(failure) ?? genericFailureCopy(failure);
    announceProblem(copy);
    action.onFailure?.(failure);
    if (failure.status === 401) window.location.assign('/');
    return null;
  } finally {
    setBusy(action.button, false);
  }
}
