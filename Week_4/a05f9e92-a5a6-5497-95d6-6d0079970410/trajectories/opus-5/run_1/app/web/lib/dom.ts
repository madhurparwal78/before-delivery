/** Small element helpers. Every control is built with its published name. */

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (name.startsWith('data') || name.startsWith('aria') || name === 'role') {
      node.setAttribute(name.replace(/^data([A-Z])/, (_m, c: string) => `data-${c.toLowerCase()}`), String(value));
    } else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function button(label: string, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attrs }, [label]);
}

export function link(label: string, href: string, attrs: Attrs = {}): HTMLAnchorElement {
  return el('a', { href, ...attrs }, [label]);
}

export function heading(level: 1 | 2 | 3, text: string, attrs: Attrs = {}): HTMLElement {
  return el(`h${level}` as 'h1', attrs, [text]);
}

export function section(attrs: Attrs = {}, children: (Node | string | null)[] = []): HTMLElement {
  return el('div', attrs, children);
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  attrs: Attrs = {},
): HTMLElement {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return el('div', { class: 'field', ...attrs }, [
    el('label', { for: id }, [labelText]),
    control,
  ]);
}

export function textbox(name: string, value = '', attrs: Attrs = {}): HTMLElement {
  const input = el('input', { type: 'text', value, 'aria-label': name, ...attrs });
  return input;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** Focus moves to this element once it is in the document. */
export function focus(node: HTMLElement | null): void {
  if (!node) return;
  if (!node.hasAttribute('tabindex') && !isNativelyFocusable(node)) node.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => node.focus());
}

function isNativelyFocusable(node: HTMLElement): boolean {
  return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName);
}

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The two published timings on one curve that starts fast and settles softly. */
export const timings = { quick: 180, settle: 420 } as const;
export const easing = 'cubic-bezier(0.2, 0.9, 0.2, 1)';

export function animate(
  node: Element,
  frames: Keyframe[],
  duration: number,
): Animation | null {
  if (prefersReducedMotion()) return null;
  return node.animate(frames, { duration, easing, fill: 'none' });
}

export function selectBox(
  name: string,
  options: { value: string; label: string }[],
  value: string | null,
  attrs: Attrs = {},
): HTMLSelectElement {
  const node = el('select', { 'aria-label': name, ...attrs });
  for (const option of options) {
    const item = el('option', { value: option.value }, [option.label]);
    if (option.value === value) item.selected = true;
    node.append(item);
  }
  return node;
}
