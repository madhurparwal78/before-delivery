export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function statusRegion(name: string, extraClass = ''): HTMLElement {
  return el('p', {
    role: 'status',
    'aria-label': name,
    'aria-live': 'polite',
    class: `status ${extraClass}`.trim(),
    'data-status': name,
  });
}

export function setStatus(node: HTMLElement, text: string): void {
  node.textContent = text;
}

export function section(name: string, children: (Node | string)[]): HTMLElement {
  return el('section', { 'aria-label': name, class: 'pane' }, [
    el('h2', { class: 'pane-label', text: name }),
    ...children,
  ]);
}

export function labelledField(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 10)}`;
  input.id = id;
  return el('div', { class: 'field' }, [
    el('label', { for: id, text: labelText }),
    input,
  ]);
}

export function textField(labelText: string, value = ''): {
  wrapper: HTMLElement;
  input: HTMLInputElement;
} {
  const input = el('input', { type: 'text', value, autocomplete: 'off' });
  return { wrapper: labelledField(labelText, input), input };
}

export function passcodeField(labelText: string): {
  wrapper: HTMLElement;
  input: HTMLInputElement;
} {
  const input = el('input', { type: 'password', autocomplete: 'current-password' });
  return { wrapper: labelledField(labelText, input), input };
}

export function selectField(labelText: string, options: { value: string; label: string }[]): {
  wrapper: HTMLElement;
  input: HTMLSelectElement;
} {
  const input = el('select', {});
  for (const option of options) {
    input.append(el('option', { value: option.value, text: option.label }));
  }
  return { wrapper: labelledField(labelText, input), input };
}

export function button(text: string, attributes: Attributes = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attributes }, [text]);
}

export function link(text: string, href: string, attributes: Attributes = {}): HTMLAnchorElement {
  return el('a', { href, ...attributes }, [text]);
}

export function hidden(text: string): HTMLElement {
  return el('span', { class: 'visually-hidden', text });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function wireInternalLink(anchor: HTMLAnchorElement): HTMLAnchorElement {
  anchor.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(anchor.getAttribute('href') ?? '/');
  });
  return anchor;
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

export function twoDecimals(value: number): string {
  return value.toFixed(2);
}
