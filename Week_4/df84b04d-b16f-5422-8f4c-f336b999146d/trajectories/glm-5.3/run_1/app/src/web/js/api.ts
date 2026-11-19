export interface BulletView {
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  mirrorOf: string | null;
  placeholder: boolean;
  revision: number;
  childCount: number;
}

export interface OutlinePayload {
  root: BulletView | null;
  ancestors: BulletView[];
  seq: number;
  bullets: BulletView[];
}

export interface MePayload {
  user: { id: string; email: string; name: string; hideCompleted: boolean };
  shared: { bulletId: string; text: string; owner: { name: string } }[];
}

export interface SharePayload {
  id: string;
  email: string;
  status: string;
  createdAt: number;
}

export interface ApiErrorBody {
  status: number;
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  current?: { text: string; revision: number };
  editor?: { name: string };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T & Partial<ApiErrorBody> }> {
  const response = await fetch(path, {
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...init,
  });
  let body: T & Partial<ApiErrorBody>;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = (await response.json()) as T & Partial<ApiErrorBody>;
  } else {
    body = {} as T & Partial<ApiErrorBody>;
  }
  return { ok: response.ok, status: response.status, body };
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export function announce(message: string): void {
  const region = document.getElementById('status-announcements');
  if (region) {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 30);
  }
}

export function problem(message: string): void {
  const region = document.getElementById('alert-problems');
  if (region) {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 30);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | null | undefined> | null = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null) continue;
    if (value === true) {
      node.setAttribute(key, '');
    } else if (value !== false) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function trimmedName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'Untitled';
  return trimmed.slice(0, 60);
}

export function countBullets(n: number): string {
  return n === 1 ? '1 bullet' : `${n} bullets`;
}

export const PLACEHOLDER_COPY = 'This bullet was deleted.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: string): string {
  const parts = date.split('-');
  const day = Number(parts[2]);
  const month = MONTHS[Number(parts[1]) - 1] ?? '';
  return `${day} ${month} ${parts[0]}`;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function icon(name: string): SVGElement {
  const paths: Record<string, string> = {
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    up: 'M18 15l-6-6-6 6',
    down: 'M6 9l6 6 6-6',
    home: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10',
    plus: 'M12 5v14M5 12h14',
    chevron: 'M6 9l6 6 6-6',
    share: 'M4 12v8h16v-8M12 3v13M8 7l4-4 4 4',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 1 1 0 10h-3',
    redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 1 0 0 10h3',
    mirror: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5M3 12h18',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
    search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'M6 6l12 12M18 6L6 18',
    at: 'M16 12a4 4 0 1 1-4-4 4 4 0 0 1 4 4zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-9 9h4',
    check: 'M4 12l5 5L20 6',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] ?? '');
  svg.appendChild(path);
  return svg;
}
