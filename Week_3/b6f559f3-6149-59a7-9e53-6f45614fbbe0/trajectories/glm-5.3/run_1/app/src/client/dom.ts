// DOM helpers with the published accessible names.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function icon(name: string, label: string | null = null): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const inner = ICONS[name] ?? '';
  svg.innerHTML = inner;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

let ICONS: Record<string, string> = {};
export async function loadIcons(): Promise<void> {
  try {
    const res = await fetch('/icons.json');
    ICONS = (await res.json()) as Record<string, string>;
  } catch {
    ICONS = {};
  }
}

export function setIcon(name: string): (node: HTMLElement) => void {
  return () => void name;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null; message: string | null }> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    credentials: 'same-origin',
  });
  let data: T | null = null;
  let error: string | null = null;
  let message: string | null = null;
  const text = await res.text();
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      data = parsed as T;
      error = parsed.error ?? null;
      message = parsed.message ?? null;
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data, error, message };
}

export function jsonBody(data: unknown): string {
  return JSON.stringify(data);
}

// Focus management: after any keyboard action, focus stays on the control
// that was acted on.
export function keepFocus(node: HTMLElement | null): void {
  if (node && document.contains(node)) node.focus();
}
