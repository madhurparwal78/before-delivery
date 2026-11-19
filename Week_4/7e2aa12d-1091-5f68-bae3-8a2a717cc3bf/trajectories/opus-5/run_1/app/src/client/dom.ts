type Child = Node | string | null | undefined | false;

export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
      continue;
    }
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export interface ApiReply<T> {
  status: number;
  body: T;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiReply<T> | null> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : null) as T };
  } catch {
    return null;
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function undoShortcut(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.key.toLowerCase() !== 'z') return null;
  return event.shiftKey ? 'redo' : 'undo';
}
