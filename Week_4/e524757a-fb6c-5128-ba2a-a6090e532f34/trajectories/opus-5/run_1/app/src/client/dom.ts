export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function need<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element ${id}`);
  return found as T;
}

export function all<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function bootstrap<T>(): T {
  const node = document.getElementById('bootstrap');
  return JSON.parse(node?.textContent ?? '{}') as T;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const MULTI_LINE = new Set(['world-status', 'gallery-status', 'safari-status', 'notes-status', 'photo-status']);
const KEEP = 5;

export function announce(id: string, message: string): void {
  const region = byId(id);
  if (!region) return;
  if (MULTI_LINE.has(id)) {
    const lines = Array.from(region.querySelectorAll('p')).map((line) => line.textContent ?? '');
    lines.push(message);
    while (lines.length > KEEP) lines.shift();
    region.replaceChildren(...lines.map(paragraph));
    return;
  }
  region.replaceChildren(paragraph(message));
}

export function clearStatus(id: string): void {
  byId(id)?.replaceChildren();
}

function paragraph(text: string): HTMLParagraphElement {
  const node = document.createElement('p');
  node.textContent = text;
  return node;
}

export function appendLog(id: string, text: string, image?: { src: string; alt: string }): void {
  const region = byId(id);
  if (!region) return;
  const line = document.createElement('p');
  line.textContent = text;
  if (image) {
    const picture = document.createElement('img');
    picture.src = image.src;
    picture.alt = image.alt;
    picture.width = 120;
    picture.height = 68;
    line.append(picture);
  }
  region.append(line);
}

export type ApiAnswer<T> = { ok: boolean; status: number; body: T & { error?: string; message?: string }; retryAfter: number | null };

export async function api<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: BodyInit } = {},
): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body });
  const retry = response.headers.get('retry-after');
  let parsed: unknown = {};
  const text = await response.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body: parsed as T & { error?: string; message?: string },
    retryAfter: retry === null ? null : Number.parseInt(retry, 10),
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusable(root: HTMLElement): HTMLElement[] {
  return all<HTMLElement>(FOCUSABLE, root).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

type OpenPanel = { element: HTMLElement; opener: HTMLElement | null; modal: boolean };

const stack: OpenPanel[] = [];

export function openPanel(element: HTMLElement, opener: HTMLElement | null, initial?: HTMLElement | null): void {
  if (stack.some((entry) => entry.element === element)) return;
  element.hidden = false;
  const modal = element.getAttribute('aria-modal') === 'true';
  stack.push({ element, opener, modal });
  const target = initial ?? focusable(element)[0] ?? element;
  target.focus();
}

export function closePanel(element: HTMLElement): void {
  const index = stack.findIndex((entry) => entry.element === element);
  if (index === -1) return;
  const entry = stack[index];
  stack.splice(index, 1);
  element.hidden = true;
  entry.opener?.focus();
}

export function topPanel(): HTMLElement | null {
  return stack.length > 0 ? stack[stack.length - 1].element : null;
}

export function isOpen(element: HTMLElement): boolean {
  return stack.some((entry) => entry.element === element);
}

document.addEventListener('keydown', (event) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Tab' && top.modal) {
    const nodes = focusable(top.element);
    if (nodes.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    let index = current ? nodes.indexOf(current) : -1;
    event.preventDefault();
    index = event.shiftKey ? index - 1 : index + 1;
    if (index < 0) index = nodes.length - 1;
    if (index >= nodes.length) index = 0;
    nodes[index].focus();
  }
});

export function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export function pressed(button: HTMLElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}
