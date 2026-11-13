export function find<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  return element;
}

export function make(
  tag: string,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function setRegion(selector: string, text: string): void {
  const region = find(selector);
  if (!region) return;
  if (region.textContent === text) {
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = text;
    });
    return;
  }
  region.textContent = text;
}

export function announce(text: string): void {
  setRegion('#announcer', text);
}

export function alertNow(text: string): void {
  setRegion('#alert', text);
}

export interface ApiAnswer<T> {
  status: number;
  body: T;
  failed: boolean;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; pen?: string | null } = {},
): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.pen) headers['x-pen'] = options.pen;
  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text.length > 0 ? JSON.parse(text) : null) as T,
      failed: false,
    };
  } catch {
    return { status: 0, body: null as T, failed: true };
  }
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string>; seq?: number; holder?: string | null };
}

export function errorOf(body: unknown): ApiError['error'] | null {
  if (body && typeof body === 'object' && 'error' in body) {
    return (body as ApiError).error;
  }
  return null;
}

export function bootstrap<T>(): T {
  const script = document.getElementById('bootstrap');
  return JSON.parse(script?.textContent ?? '{}') as T;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function openSocket(onMessage: (message: unknown) => void, onOpen: (socket: WebSocket) => void): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener('open', () => onOpen(socket));
  socket.addEventListener('message', (event) => {
    onMessage(JSON.parse(String(event.data)));
  });
  return socket;
}
