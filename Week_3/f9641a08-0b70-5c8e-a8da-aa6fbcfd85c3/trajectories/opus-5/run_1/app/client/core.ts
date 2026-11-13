export type ApiErrorBody = {
  error: string;
  message: string;
  fields?: Record<string, string>;
  sku?: string;
  available?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: payload,
    credentials: 'same-origin'
  });
  if (response.status === 204) return undefined as unknown as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiError(response.status, (parsed ?? { error: 'error', message: 'Request failed.' }) as ApiErrorBody);
  }
  return parsed as T;
}

export async function upload<T>(path: string, form: FormData, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form, headers, credentials: 'same-origin' });
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiError(response.status, (parsed ?? { error: 'error', message: 'Upload failed.' }) as ApiErrorBody);
  }
  return parsed as T;
}

export function groupIndian(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(Math.round(value)));
  let out: string;
  if (digits.length <= 3) {
    out = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    out = `${parts.join(',')},${last3}`;
  }
  return negative ? `-${out}` : out;
}

export function rupees(value: number): string {
  return value < 0 ? `-₹${groupIndian(-value)}` : `₹${groupIndian(value)}`;
}

export function appConfig(): Record<string, number> {
  const node = document.getElementById('app-config');
  if (node === null) return {};
  return JSON.parse(node.textContent ?? '{}') as Record<string, number>;
}

export function sessionInfo(): { signed_in: boolean; role: string | null } {
  const node = document.getElementById('app-session');
  if (node === null) return { signed_in: false, role: null };
  return JSON.parse(node.textContent ?? '{}') as { signed_in: boolean; role: string | null };
}

export function jsonScript<T>(id: string, fallback: T): T {
  const node = document.getElementById(id);
  if (node === null) return fallback;
  return JSON.parse(node.textContent ?? 'null') as T;
}

export function newIdempotencyKey(): string {
  return `rh-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyMotionAttributes(root: ParentNode = document): void {
  const reduced = reducedMotion();
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  if (!reduced) return;
  for (const element of qsa<HTMLElement>('[data-motion-ms]', root)) {
    element.dataset.motionMs = '0';
  }
}

export function motionDuration(element: HTMLElement, fallback: number): number {
  if (reducedMotion()) return 0;
  const value = Number(element.dataset.motionMs ?? String(fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function runStates(element: HTMLElement, mid: string, end: string, fallbackMs: number): void {
  const ms = motionDuration(element, fallbackMs);
  if (ms === 0) {
    element.dataset.state = end;
    return;
  }
  element.dataset.state = mid;
  window.setTimeout(() => {
    element.dataset.state = end;
  }, ms);
}

export function announce(label: string, text: string): void {
  const region = qs<HTMLElement>(`[data-region="${label}"]`);
  if (region === null) return;
  region.textContent = text;
}

export function cartAnnounce(text: string): void {
  announce('cart-updates', text);
  showToast(text, false);
}

let toastTimer = 0;

export function showToast(text: string, withUndo: boolean): void {
  const toast = qs<HTMLElement>('[data-toast]');
  if (toast === null) return;
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  const config = appConfig();
  const seconds = withUndo ? config.cart_undo_seconds ?? 6 : config.toast_seconds ?? 5;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, seconds * 1000);
}
