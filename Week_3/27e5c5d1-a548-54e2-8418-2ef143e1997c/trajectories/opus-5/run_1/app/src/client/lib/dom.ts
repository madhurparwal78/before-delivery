export interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: never) => void>>;
  focusKey?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.focusKey !== undefined) node.dataset['fk'] = options.focusKey;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, handler as EventListener);
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function focusKeyOf(node: Element | null): string | null {
  if (node === null || !(node instanceof HTMLElement)) return null;
  return node.dataset['fk'] ?? null;
}

export function byFocusKey(root: ParentNode, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`);
}

export interface CaretState {
  key: string;
  start: number | null;
  end: number | null;
}

export function captureCaret(): CaretState | null {
  const active = document.activeElement;
  const key = focusKeyOf(active);
  if (key === null) return null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return { key, start: active.selectionStart, end: active.selectionEnd };
  }
  return { key, start: null, end: null };
}

export function restoreCaret(root: ParentNode, caret: CaretState | null): void {
  if (caret === null) return;
  const node = byFocusKey(root, caret.key);
  if (node === null) return;
  node.focus();
  if (caret.start === null) return;
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    try {
      node.setSelectionRange(caret.start, caret.end);
    } catch {
      // Some input types refuse a selection range; focus alone is enough.
    }
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
