/** Small helpers for building and keeping the desk's elements. */

export type Attrs = Record<string, string | number | boolean>;

export function el<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[Tag] {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    made.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) made.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return made;
}

/** Set text only when it changed, so live updates never touch a settled element. */
export function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keydown handling on a field whose element type is a union. */
export function onKeyDown(node: HTMLElement, handler: (event: KeyboardEvent) => void): void {
  node.addEventListener('keydown', (event) => handler(event as KeyboardEvent));
}

export function focusOn(node: HTMLElement | null): void {
  if (node === null) return;
  node.focus({ preventScroll: false });
}
