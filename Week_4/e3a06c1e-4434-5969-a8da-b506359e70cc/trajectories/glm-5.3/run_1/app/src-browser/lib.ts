// Shared browser utilities: API client, DOM helpers, routing, announcements.

export type Json = Record<string, unknown>;

export async function api<T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string; raw?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; fields?: Record<string, string> };
    const e = new Error(err.message ?? 'Something went wrong. Try again.') as Error & { status: number; code: string; fields: Record<string, string> };
    e.status = res.status;
    e.code = err.error ?? 'error';
    e.fields = err.fields ?? {};
    throw e;
  }
  return (data ?? null) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return api<T>('GET', path);
}

// ---------- routing ----------

type RouteHandler = () => Promise<void>;

const routes: { pattern: RegExp; handler: RouteHandler }[] = [];

export function registerRoute(pattern: string, handler: RouteHandler): void {
  routes.push({ pattern: new RegExp(`^${pattern}$`), handler });
}

export async function navigate(url: string, replace = false): Promise<void> {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  await render();
}

export async function render(): Promise<void> {
  const path = location.pathname;
  for (const r of routes) {
    if (r.pattern.test(path)) {
      await r.handler();
      return;
    }
  }
  await notFound();
}

async function notFound(): Promise<void> {
  document.title = 'Lowfield Console';
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const section = el('section', { 'aria-label': 'Not found' });
  section.append(el('h1', {}, 'Not found'));
  const link = el('a', { href: '/' }, 'Go to the public site');
  link.addEventListener('click', (ev) => { ev.preventDefault(); void navigate('/'); });
  section.append(link);
  root.append(section);
}

// ---------- DOM ----------

export type Attrs = Record<string, string | number | boolean | null | undefined> & { class?: string };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A polite status region that announces exactly once per change. */
export function statusRegion(name: string, id?: string): HTMLElement {
  return el('div', { id, role: 'status', 'aria-live': 'polite', class: 'status', 'data-region': name });
}

export function setStatus(region: HTMLElement, text: string): void {
  // Setting textContent to '' then the value makes some screen readers re-announce identical copy.
  if (region.textContent === text) return;
  region.textContent = text;
}

// ---------- announcements without focus moves ----------

export function announce(region: HTMLElement, text: string): void {
  setStatus(region, text);
}

// ---------- misc ----------

export function fmtClock(iso: string | null): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${fmtClock(iso)}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Reduced-motion preference, live. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onReducedMotionChange(fn: () => void): void {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', fn);
}

export function isWide(bp: number): boolean {
  return window.matchMedia(`(min-width: ${bp}px)`).matches;
}

export function onBreakpointChange(fn: () => void): void {
  for (const bp of [768, 1200]) {
    window.matchMedia(`(min-width: ${bp}px)`).addEventListener('change', fn);
  }
}
