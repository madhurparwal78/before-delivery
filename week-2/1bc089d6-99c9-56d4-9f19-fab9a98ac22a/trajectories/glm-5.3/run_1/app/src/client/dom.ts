// Small DOM helpers shared by every page.
export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | null> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Announce a result in its named live region, replacing the previous text.
export function announce(status: HTMLElement | null, text: string): void {
  if (!status) return;
  status.textContent = '';
  const fragment = document.createDocumentFragment();
  fragment.append(text);
  requestAnimationFrame(() => {
    status.textContent = text;
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export interface ApiResult<T> {
  status: number;
  body: T | null;
  headers: Headers;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(url, init);
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

export function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
