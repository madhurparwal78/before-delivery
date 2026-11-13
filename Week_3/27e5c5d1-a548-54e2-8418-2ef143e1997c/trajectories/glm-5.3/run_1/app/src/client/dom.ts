// DOM helpers and shared client utilities.
export function el(
  tag: string,
  attrs: Record<string, string | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function input(tag: 'input', attrs: Record<string, string>, ...children: (Node | string | null | undefined)[]): HTMLInputElement;
export function input(tag: 'textarea', attrs: Record<string, string>, ...children: (Node | string | null | undefined)[]): HTMLTextAreaElement;
export function input(tag: 'select', attrs: Record<string, string>, ...children: (Node | string | null | undefined)[]): HTMLSelectElement;
export function input(tag: string, attrs: Record<string, string>, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = el(tag, attrs, ...children);
  if (tag === 'input') return node as HTMLInputElement;
  if (tag === 'textarea') return node as HTMLTextAreaElement;
  return node as HTMLSelectElement;
}

export function buttonEl(attrs: Record<string, string>, ...children: (Node | string | null | undefined)[]): HTMLButtonElement {
  return el('button', attrs, ...children) as HTMLButtonElement;
}

/** Counts length in Unicode code points, matching the server. */
export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Straight-apostrophe text helper: shows control characters as ? for file names. */
export function displayFilename(name: string): string {
  let result = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 63;
    result += code <= 31 || code === 127 ? '?' : ch;
  }
  return result;
}

export function listCountText(count: number): string {
  if (count === 1) return '1 card';
  return `${count} cards`;
}

export function drawerCountText(count: number): string {
  if (count === 1) return '1 open';
  return `${count} open`;
}
