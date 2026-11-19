/** The event shapes screens hand to `el`, narrowed once inside `applyAttr`. */
export type AttrHandler =
  | ((event: Event) => void)
  | ((event: KeyboardEvent) => void)
  | ((event: MouseEvent) => void)
  | ((event: PointerEvent) => void);

export type AttrValue = string | number | boolean | null | undefined | AttrHandler;

export interface Attrs {
  [key: string]: AttrValue;
}

type Child = Node | string | null | undefined | false;

function applyAttr(element: Element, key: string, value: AttrValue): void {
  if (value === null || value === undefined || value === false) return;
  if (key.startsWith('on') && typeof value === 'function') {
    element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    return;
  }
  if (key === 'class') {
    element.setAttribute('class', String(value));
    return;
  }
  if (key === 'value' && element instanceof HTMLInputElement) {
    element.value = String(value);
    return;
  }
  if (key === 'value' && element instanceof HTMLTextAreaElement) {
    element.value = String(value);
    return;
  }
  if (value === true) {
    element.setAttribute(key, '');
    return;
  }
  element.setAttribute(key, String(value));
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) applyAttr(element, key, value);
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function svg(markup: string): Element {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const first = holder.firstElementChild;
  if (!first) throw new Error('empty svg markup');
  return first;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

export interface FocusMemory {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
}

export function rememberFocus(): FocusMemory | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const key = active.dataset.focusKey;
  if (!key) return null;
  const selectable =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active
      : null;
  return {
    key,
    selectionStart: selectable ? selectable.selectionStart : null,
    selectionEnd: selectable ? selectable.selectionEnd : null,
    scrollTop: window.scrollY,
  };
}

export function restoreFocus(memory: FocusMemory | null): void {
  if (!memory) return;
  const target = document.querySelector<HTMLElement>(`[data-focus-key="${cssEscape(memory.key)}"]`);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    memory.selectionStart !== null &&
    memory.selectionEnd !== null
  ) {
    try {
      target.setSelectionRange(memory.selectionStart, memory.selectionEnd);
    } catch {
      /* selection is not supported on this input type */
    }
  }
  window.scrollTo({ top: memory.scrollTop });
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

export function focusables(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);
}
