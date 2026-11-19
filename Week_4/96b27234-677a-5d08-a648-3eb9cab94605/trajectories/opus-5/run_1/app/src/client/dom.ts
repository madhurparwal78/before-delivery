type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement
  );
}

export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusableIn(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function pageHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main h1');
}

export function focusHeading(): void {
  const heading = pageHeading();
  if (heading !== null) heading.focus();
}

export function keepFocusSafe(removed: Element): void {
  if (!removed.contains(document.activeElement)) return;
  const heading = pageHeading();
  if (heading !== null) heading.focus();
}
