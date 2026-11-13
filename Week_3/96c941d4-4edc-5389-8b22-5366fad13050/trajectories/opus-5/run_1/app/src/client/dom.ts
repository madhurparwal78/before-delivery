type Attributes = Record<string, string | number | boolean | EventListener | null>;

export function h(
  tag: string,
  attributes: Attributes = {},
  children: (Node | string | null)[] = [],
): HTMLElement {
  const element = document.createElement(tag);
  apply(element, attributes);
  for (const child of children) {
    if (child === null) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function apply(element: HTMLElement, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === false) {
      element.removeAttribute(key);
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), value as EventListener);
      continue;
    }
    if (key === 'text') {
      element.textContent = String(value);
      continue;
    }
    element.setAttribute(key, value === true ? '' : String(value));
  }
}

export function svg(
  tag: string,
  attributes: Record<string, string | number> = {},
  children: Element[] = [],
): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  for (const child of children) element.append(child);
  return element;
}

export function clear(element: Element): void {
  while (element.firstChild !== null) element.firstChild.remove();
}

export function button(
  name: string,
  onClick: () => void,
  options: { label?: string; className?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const element = h(
    'button',
    {
      type: 'button',
      class: options.className ?? 'action',
      'aria-label': options.label === undefined ? null : name,
      onclick: () => onClick(),
    },
    [options.label ?? name],
  ) as HTMLButtonElement;
  element.disabled = options.disabled === true;
  return element;
}

export function field(
  name: string,
  type: string,
  value: string,
  onInput: (value: string) => void,
  options: { inputMode?: string; className?: string } = {},
): { wrapper: HTMLElement; input: HTMLInputElement; error: HTMLElement } {
  const id = `field-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const input = h('input', {
    id,
    type,
    value,
    class: options.className ?? 'text-input',
    ...(options.inputMode === undefined ? {} : { inputmode: options.inputMode }),
    oninput: (event: Event) => onInput((event.target as HTMLInputElement).value),
  }) as HTMLInputElement;
  const error = h('p', { class: 'field-error', hidden: true });
  const wrapper = h('div', { class: 'field' }, [
    h('label', { for: id }, [name]),
    input,
    error,
  ]);
  return { wrapper, input, error };
}

export function select(
  name: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (value: string) => void,
): { wrapper: HTMLElement; input: HTMLSelectElement } {
  const id = `select-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const input = h('select', {
    id,
    class: 'text-input',
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  }) as HTMLSelectElement;
  for (const option of options) {
    input.append(h('option', { value: option.value }, [option.label]));
  }
  input.value = value;
  return {
    wrapper: h('div', { class: 'field' }, [h('label', { for: id }, [name]), input]),
    input,
  };
}

export function region(name: string, className: string, children: (Node | string | null)[]): HTMLElement {
  return h('section', { role: 'region', 'aria-label': name, class: className }, children);
}

export function table(
  name: string,
  columns: string[],
  rows: (Node | string)[][],
  className = 'data-table',
): HTMLElement {
  return h('table', { class: className, 'aria-label': name }, [
    h('thead', {}, [h('tr', {}, columns.map((column) => h('th', { scope: 'col' }, [column])))]),
    h(
      'tbody',
      {},
      rows.map((row) => h('tr', {}, row.map((cell) => h('td', {}, [cell])))),
    ),
  ]);
}
