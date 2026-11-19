/** Small DOM helpers. Every write checks first, so a refresh moves nothing. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean | null> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function find<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function need<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

export function all<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Writes text only when it differs, so nothing on screen is replaced. */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/**
 * Brings a list up to date by key, keeping the elements that stay so they can
 * carry an animation and keep focus.
 */
export function patchList<T>(
  container: Element,
  items: readonly T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): HTMLElement[] {
  const existing = new Map<string, HTMLElement>();
  for (const child of [...container.children]) {
    const key = (child as HTMLElement).dataset.key;
    if (key === undefined) child.remove();
    else existing.set(key, child as HTMLElement);
  }

  const wanted: HTMLElement[] = [];
  for (const item of items) {
    const key = keyOf(item);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
    } else {
      node = create(item);
      node.dataset.key = key;
    }
    update(node, item);
    wanted.push(node);
  }
  for (const stale of existing.values()) stale.remove();

  // Put the kept elements in order without replacing any of them.
  let at: Element | null = container.firstElementChild;
  for (const node of wanted) {
    if (at === node) {
      at = node.nextElementSibling;
      continue;
    }
    container.insertBefore(node, at);
  }
  return wanted;
}

export function onClick(node: Element, handler: (event: MouseEvent) => void): void {
  node.addEventListener('click', handler as EventListener);
}

/** The pointer type the event itself carries, never a hover media query. */
export function isMousePointer(event: PointerEvent): boolean {
  return event.pointerType === 'mouse';
}

export function focus(node: HTMLElement | null): void {
  if (!node) return;
  node.focus();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
