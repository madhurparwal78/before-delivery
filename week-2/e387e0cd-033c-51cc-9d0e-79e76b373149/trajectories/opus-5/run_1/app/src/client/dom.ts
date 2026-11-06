/** Small element helpers the screens share. */

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly html?: never;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: ReadonlyArray<Node | null>;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attributes !== undefined) {
    for (const [name, value] of Object.entries(options.attributes)) {
      node.setAttribute(name, value);
    }
  }
  for (const child of options.children ?? []) {
    if (child !== null) node.append(child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function button(
  label: string,
  onClick: () => void,
  options: { className?: string; attributes?: Record<string, string> } = {},
): HTMLButtonElement {
  const node = element('button', {
    text: label,
    className: options.className ?? 'control',
    attributes: { type: 'button', ...(options.attributes ?? {}) },
  });
  node.addEventListener('click', onClick);
  return node;
}

export function link(label: string, href: string, className = 'control link'): HTMLAnchorElement {
  return element('a', { text: label, className, attributes: { href } });
}

export function heading(level: 1 | 2 | 3 | 4, text: string, className?: string): HTMLElement {
  const node = element(`h${level}` as 'h1', { text, className });
  if (level === 1) node.setAttribute('tabindex', '-1');
  return node;
}

export function mono(text: string): HTMLElement {
  return element('span', { text, className: 'mono' });
}

export function definition(term: string, value: Node | string): HTMLElement {
  return element('div', {
    className: 'fact',
    children: [
      element('span', { text: term, className: 'fact-term' }),
      typeof value === 'string'
        ? element('span', { text: value, className: 'fact-value' })
        : element('span', { className: 'fact-value', children: [value] }),
    ],
  });
}

export interface Column<T> {
  readonly label: string;
  readonly cell: (row: T) => Node | string;
}

/** One table that becomes a stacked card list below the one breakpoint. */
export function dataTable<T>(
  name: string,
  columns: ReadonlyArray<Column<T>>,
  rows: readonly T[],
  emptyCopy: string,
): HTMLElement {
  const head = element('thead', {
    children: [
      element('tr', {
        children: columns.map((column) =>
          element('th', { text: column.label, attributes: { scope: 'col' } }),
        ),
      }),
    ],
  });
  const body = element('tbody', {
    children: rows.map((row) =>
      element('tr', {
        children: columns.map((column) => {
          const value = column.cell(row);
          return element('td', {
            attributes: { 'data-label': column.label },
            children: [typeof value === 'string' ? document.createTextNode(value) : value],
          });
        }),
      }),
    ),
  });
  const table = element('table', {
    className: 'data-table',
    attributes: { 'aria-label': name },
    children: [head, body],
  });
  const wrapper = element('div', { className: 'table-wrap', children: [table] });
  if (rows.length === 0) {
    wrapper.append(element('p', { text: emptyCopy, className: 'empty' }));
  }
  keyboardScrollable(wrapper, name);
  return wrapper;
}

/** A scrollable region needs keyboard access when it actually scrolls. */
export function keyboardScrollable(node: HTMLElement, label: string): void {
  requestAnimationFrame(() => {
    const scrolls = node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
    if (scrolls) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', label);
      return;
    }
    node.removeAttribute('tabindex');
    node.removeAttribute('role');
    node.removeAttribute('aria-label');
  });
}
