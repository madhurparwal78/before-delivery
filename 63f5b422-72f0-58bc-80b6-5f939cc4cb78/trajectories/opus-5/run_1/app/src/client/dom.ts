export type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setAttrs(node: HTMLElement, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, String(value));
  }
}

export function setAttr(node: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) node.removeAttribute(name);
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function button(label: string, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attrs }, [label]);
}

/** Keyed child reconciliation that keeps existing elements, and their focus. */
export function patchChildren<T>(
  parent: HTMLElement,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): HTMLElement[] {
  const existing = new Map<string, HTMLElement>();
  for (const child of [...parent.children]) {
    const childKey = (child as HTMLElement).dataset['key'];
    if (childKey !== undefined) existing.set(childKey, child as HTMLElement);
  }
  const wanted: HTMLElement[] = [];
  for (const item of items) {
    const itemKey = key(item);
    let node = existing.get(itemKey);
    if (node === undefined) {
      node = create(item);
      node.dataset['key'] = itemKey;
    } else {
      existing.delete(itemKey);
    }
    update(node, item);
    wanted.push(node);
  }
  for (const stale of existing.values()) stale.remove();
  for (let i = 0; i < wanted.length; i += 1) {
    const node = wanted[i]!;
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
  }
  return wanted;
}

const ICONS: Record<string, string> = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m6.08 11-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83L17.9 11"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-11Z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  message: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  fan: '<path d="M12 12 4 6"/><path d="M12 12v10"/><path d="m12 12 8-6"/><path d="M12 2a10 10 0 0 1 10 10"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pencil: '<path d="M21.2 6.2 17.8 2.8a2 2 0 0 0-2.8 0L3 14.8V21h6.2L21.2 9a2 2 0 0 0 0-2.8Z"/>',
};

/** Inline Lucide drawings; the app ships no icon font. */
export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  svg.innerHTML = ICONS[name] ?? ICONS['panel']!;
  return svg;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/** Tab and Shift+Tab cycle inside dialogs and sheets. */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusables(container);
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function isTextEntry(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return (node as HTMLElement).isContentEditable;
  const type = (node as HTMLInputElement).type;
  return type === 'text' || type === 'email' || type === 'password' || type === 'search';
}
