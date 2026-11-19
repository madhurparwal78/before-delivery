export type Child = Node | string | null | undefined | Child[];

export interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  data?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, (event: Event) => void>;
}

function appendChild(parent: Node, child: Child): void {
  if (child === null || child === undefined) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(parent, item);
    return;
  }
  parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children?: Child,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, value] of Object.entries(options.data ?? {})) {
    if (value === null || value === undefined) continue;
    node.dataset[name] = String(value);
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, handler);
  }
  appendChild(node, children);
  return node;
}

export function table(
  name: string,
  headers: string[],
  rows: Child[][],
  emptyCopy?: string,
): HTMLElement {
  const head = el(
    'thead',
    {},
    el(
      'tr',
      {},
      headers.map((header) => el('th', { attrs: { scope: 'col' }, text: header })),
    ),
  );
  const bodyRows =
    rows.length > 0
      ? rows.map((cells) => el('tr', {}, cells.map((cell) => el('td', {}, cell))))
      : [
          el(
            'tr',
            {},
            el('td', { attrs: { colspan: headers.length }, text: emptyCopy ?? 'Nothing yet.' }),
          ),
        ];
  return el(
    'div',
    { class: 'panel' },
    el('table', { attrs: { 'aria-label': name } }, [
      el('caption', { text: name }),
      head,
      el('tbody', {}, bodyRows),
    ]),
  );
}

export function definitionList(name: string, items: [string, Child][]): HTMLElement {
  return el(
    'ul',
    { class: 'list', attrs: { 'aria-label': name } },
    items.map(([label, value]) =>
      el('li', {}, [el('span', { class: 'label', text: label }), el('span', {}, value)]),
    ),
  );
}

export function copyPill(value: string): HTMLElement {
  return el(
    'button',
    {
      class: 'pill pill-outline copy-pill',
      attrs: { type: 'button' },
      on: {
        click: () => {
          void navigator.clipboard?.writeText(value);
        },
      },
    },
    'Copy',
  );
}

/** A split-letter section heading whose accessible name stays the whole word. */
export function splitHeading(level: 'h2' | 'h3', words: string): HTMLElement {
  const heading = el(level, { class: 'split-letter', attrs: { 'aria-label': words } });
  [...words].forEach((character, index) => {
    heading.appendChild(
      el(
        'span',
        {
          attrs: { 'aria-hidden': 'true' },
          data: { letter: index },
        },
        character === ' ' ? '\u00a0' : character,
      ),
    );
  });
  return heading;
}

export function emptyState(sentence: string, actionLabel: string, href: string): HTMLElement {
  return el('div', { class: 'panel' }, [
    el('p', { class: 'empty-state', text: sentence }),
    el('a', { class: 'pill pill-outline', attrs: { href } }, actionLabel),
  ]);
}

export function field(
  id: string,
  label: string,
  control: HTMLElement,
  note?: string,
): HTMLElement {
  const wrapper = el('div', { class: 'field' }, [
    el('label', { attrs: { for: id }, text: label }),
    control,
  ]);
  if (note) wrapper.appendChild(el('p', { class: 'field-note', text: note }));
  wrapper.appendChild(el('p', { class: 'field-error', attrs: { id: `${id}-error` } }));
  return wrapper;
}

/** Field errors appear under the field, linked as its description. */
export function setFieldError(form: HTMLElement, fieldName: string, message: string): void {
  const control = form.querySelector<HTMLElement>(`[data-field="${fieldName}"]`);
  if (!control) return;
  const error = form.querySelector<HTMLElement>(`#${control.id}-error`);
  if (error) error.textContent = message;
  control.setAttribute('aria-describedby', `${control.id}-error`);
  control.setAttribute('aria-invalid', 'true');
  control.focus();
}

export function clearFieldErrors(form: HTMLElement): void {
  for (const error of form.querySelectorAll<HTMLElement>('.field-error')) error.textContent = '';
  for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid]')) {
    control.removeAttribute('aria-invalid');
  }
}
