type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined;

export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  children: Child[] = []
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  setAttributes(node, attributes);
  append(node, children);
  return node;
}

export function setAttributes(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
}

export function append(node: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function button(name: string, attributes: Attributes = {}): HTMLButtonElement {
  return element('button', { type: 'button', ...attributes }, [name]);
}

export function labelledInput(
  label: string,
  attributes: Attributes = {}
): { field: HTMLLabelElement; input: HTMLInputElement } {
  const input = element('input', { type: 'text', ...attributes });
  const field = element('label', { class: 'field' }, [element('span', {}, [label]), input]);
  return { field, input };
}

/** Rebuilds a region while keeping the keyboard where it was. */
export function keepFocus(run: () => void): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement ? active.dataset.focusKey ?? null : null;
  run();
  if (key === null) return;
  const next = document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
  if (next !== null && next !== document.activeElement) next.focus();
}
