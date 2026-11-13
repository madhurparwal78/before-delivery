export type Attributes = Record<string, string | number | boolean | null | undefined>;

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
    else if (name === 'html') node.innerHTML = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
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






export function focusTrap(dialog: HTMLElement, onClose: () => void): void {
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => !node.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}


/** Wraps each published offset range in a mark, so highlights sit at their rule D offsets. */
export function highlighted(text: string, ranges: [number, number][]): HTMLElement {
  const node = el('span');
  if (ranges.length === 0) {
    node.textContent = text;
    return node;
  }
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor || start > text.length) continue;
    node.append(document.createTextNode(text.slice(cursor, start)));
    node.append(el('mark', { text: text.slice(start, end) }));
    cursor = end;
  }
  node.append(document.createTextNode(text.slice(cursor)));
  return node;
}
