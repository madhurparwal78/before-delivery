type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttribute(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * Marks a control busy while its request is in flight. It reads as disabled and does
 * nothing when activated, but keeps focus, which a native disabled attribute would lose.
 */
export function setBusy(control: HTMLElement, busy: boolean, labels?: { busy: string; idle: string }): void {
  if (busy) {
    control.setAttribute('aria-disabled', 'true');
    control.dataset.busy = 'true';
    if (labels) setText(control, labels.busy);
    return;
  }
  control.removeAttribute('aria-disabled');
  delete control.dataset.busy;
  if (labels) setText(control, labels.idle);
}

export function isBusy(control: HTMLElement): boolean {
  return control.dataset.busy === 'true';
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isWideLayout(): boolean {
  return window.innerWidth >= 768;
}
