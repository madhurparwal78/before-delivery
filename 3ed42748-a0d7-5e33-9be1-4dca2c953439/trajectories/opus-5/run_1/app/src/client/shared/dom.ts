type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttributes(node, attributes);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function setAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') {
      node.setAttribute('class', String(value));
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function svg(tag: string, attributes: Attributes = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  setAttributes(node, attributes);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export const focusables =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(focusables)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** Keeps Tab inside a dialog. */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const stops = focusableIn(root);
  if (stops.length === 0) return;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function whole(value: number): string {
  return String(Math.round(value));
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

export function twoDecimals(value: number): string {
  return value.toFixed(2);
}

export function localTimeOfDay(iso: string): string {
  const when = new Date(iso);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}
