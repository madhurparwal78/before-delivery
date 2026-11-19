export type Child = Node | string | number | null | undefined | false;

export interface Attributes {
  [key: string]: string | number | boolean | null | undefined | EventListener;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

export function svg(tag: string, attributes: Record<string, string | number>, ...children: SVGElement[]): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  for (const child of children) node.appendChild(child);
  return node;
}

function applyAttributes(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2), value as EventListener);
    } else if (name === 'class') {
      node.className = String(value);
    } else if (name === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(name, '');
    } else {
      node.setAttribute(name, String(value));
    }
  }
}

export function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function focusables(root: ParentNode): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node.tagName === 'DIALOG',
  );
}

/** Keeps Tab inside the dialog and restores focus to the opener when it closes. */
export function trapFocus(dialog: HTMLDialogElement, opener: HTMLElement | null): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const nodes = focusables(dialog);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', onKeyDown);
  const onClose = (): void => {
    dialog.removeEventListener('keydown', onKeyDown);
    dialog.removeEventListener('close', onClose);
    opener?.focus();
  };
  dialog.addEventListener('close', onClose);
  return () => dialog.close();
}

export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null): void {
  document.body.appendChild(dialog);
  trapFocus(dialog, opener);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  const nodes = focusables(dialog);
  nodes[0]?.focus();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isDesktop(): boolean {
  return window.innerWidth >= 768;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function phase(progress: number, start: number, end: number): number {
  return clamp((progress - start) / (end - start), 0, 1);
}
