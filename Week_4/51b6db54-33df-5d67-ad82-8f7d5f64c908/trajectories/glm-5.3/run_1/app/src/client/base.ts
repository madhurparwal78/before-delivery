// Client API layer and small DOM helpers, shared by every page.
export interface Me { id: number; email: string; name: string; number_format: string; time_zone: string }

export class ApiFail extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body['message'] ?? (body['errors'] as Record<string, string> | undefined)?.[Object.keys(body['errors'] as object)[0] ?? ''] ?? body['error'] ?? 'error'));
    this.status = status;
    this.body = body;
  }
  fieldErrors(): Record<string, string> | null {
    const e = this.body['errors'] as Record<string, string> | undefined;
    return e ?? null;
  }
  notice(): string { return String(this.body['message'] ?? this.body['error'] ?? ''); }
}

async function request(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin'
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFail(res.status, (data ?? {}) as Record<string, unknown>);
  return data;
}

export const api = {
  get: (p: string): Promise<unknown> => request('GET', p),
  post: (p: string, b?: unknown, o?: { idempotencyKey?: string }): Promise<unknown> => request('POST', p, b, o),
  put: (p: string, b?: unknown): Promise<unknown> => request('PUT', p, b),
  patch: (p: string, b?: unknown): Promise<unknown> => request('PATCH', p, b),
  del: (p: string): Promise<unknown> => request('DELETE', p)
};

// ---- DOM helpers ----

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string | number | boolean | ((e: Event) => void)>, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v as EventListener);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

export function qs<E extends Element = HTMLElement>(sel: string, root?: ParentNode): E | null {
  return (root ?? document).querySelector<E>(sel);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export interface ConfigInfo {
  now: string; palette_max: number; sprite_max: number; frame_min_ms: number; frame_max_ms: number;
  invite_ttl_seconds: number; long_press_ms: number; presence_visible: number; idle_seconds: number;
  undo_depth: number; activity_page: number; autosave_ms: number; job_item_ms: number; import_max_bytes: number;
}

export let appConfig: ConfigInfo = {
  now: new Date().toISOString(), palette_max: 255, sprite_max: 512, frame_min_ms: 10, frame_max_ms: 65535,
  invite_ttl_seconds: 604800, long_press_ms: 500, presence_visible: 4, idle_seconds: 300,
  undo_depth: 50, activity_page: 50, autosave_ms: 1000, job_item_ms: 0, import_max_bytes: 5000000
};

export async function loadConfig(): Promise<ConfigInfo> {
  const data = await api.get('/api/config') as ConfigInfo;
  appConfig = data;
  return data;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function myNumberFormat(): 'en-US' | 'en-IN' {
  const me = (window as unknown as { __me?: Me }).__me;
  return me?.number_format === 'en-IN' ? 'en-IN' : 'en-US';
}

export function myZone(): 'UTC' | 'Asia/Kolkata' | 'America/New_York' {
  const me = (window as unknown as { __me?: Me }).__me;
  const z = me?.time_zone;
  return z === 'Asia/Kolkata' || z === 'America/New_York' ? z : 'UTC';
}

export function showErrors(target: HTMLElement, fail: ApiFail): void {
  const errors = fail.fieldErrors();
  if (errors) {
    for (const [field, text] of Object.entries(errors)) {
      const fieldNode = target.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (fieldNode) fieldNode.textContent = text;
    }
    const first = Object.values(errors)[0];
    announceAlert(target, first);
  } else {
    announceAlert(target, fail.notice() || 'Something went wrong');
  }
}

export function announceAlert(scope: HTMLElement | Document, text: string): void {
  const alertNode = (scope as HTMLElement).querySelector?.('.alert-box') as HTMLElement | null
    ?? document.querySelector('.alert-box') as HTMLElement | null;
  if (alertNode) {
    alertNode.textContent = text;
    alertNode.classList.add('visible');
  }
}

export function statusText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

export function debounce(fn: () => void, ms: number): () => void {
  let t: number | undefined;
  return () => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => { t = undefined; fn(); }, ms);
  };
}
