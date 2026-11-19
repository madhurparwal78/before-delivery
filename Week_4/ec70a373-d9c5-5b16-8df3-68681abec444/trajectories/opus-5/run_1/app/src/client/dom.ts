export type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Builds an element with literal text children, so stored text can never be markup. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** A table whose roles survive the phone band, where rows are drawn as cards. */
export function table(name: string, columns: string[]): {
  root: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const root = el('table', { role: 'table', 'aria-label': name, class: 'data-table' });
  const head = el('thead', { role: 'rowgroup' });
  const headRow = el('tr', { role: 'row' });
  for (const column of columns) {
    headRow.append(el('th', { role: 'columnheader', scope: 'col', text: column }));
  }
  head.append(headRow);
  const body = el('tbody', { role: 'rowgroup' });
  root.append(head, body);
  return { root, body };
}

export function row(cells: { label: string; content: Node | string }[], attrs: Attrs = {}): HTMLTableRowElement {
  const tr = el('tr', { role: 'row', ...attrs });
  for (const cell of cells) {
    const td = el('td', { role: 'cell', 'data-label': cell.label });
    td.append(
      el('span', { class: 'cell-label', 'aria-hidden': 'true', text: cell.label }),
      typeof cell.content === 'string' ? document.createTextNode(cell.content) : cell.content,
    );
    tr.append(td);
  }
  return tr;
}

export function button(label: string, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attrs }, [label]);
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  id: string,
): HTMLElement {
  control.id = id;
  const wrapper = el('div', { class: 'field' });
  wrapper.append(el('label', { for: id, text: labelText }), control);
  return wrapper;
}

export function focus(node: HTMLElement | null): void {
  if (node === null) return;
  node.focus();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
