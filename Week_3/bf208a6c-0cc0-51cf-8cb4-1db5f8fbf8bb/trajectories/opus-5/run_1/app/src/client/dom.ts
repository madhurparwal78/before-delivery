type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'text') node.textContent = String(value);
    else if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
};

export const clear = (node: Element): void => {
  node.replaceChildren();
};

export const on = <E extends keyof HTMLElementEventMap>(
  node: HTMLElement | Document | Window,
  type: E,
  handler: (event: HTMLElementEventMap[E]) => void,
): void => {
  node.addEventListener(type, handler as EventListener);
};

export const svg = (markup: string, className: string): Element => {
  const holder = document.createElement('span');
  holder.innerHTML = markup;
  const node = holder.firstElementChild;
  if (node === null) throw new Error('icon markup missing');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', className);
  return node;
};

export const field = (
  labelText: string,
  control: HTMLElement,
  message: HTMLElement | null = null,
  hint: string | null = null,
): HTMLElement => {
  const label = el('label', { text: labelText });
  const id = `field-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  label.setAttribute('for', id);
  return el('div', { class: 'field' }, [label, control, hint === null ? null : el('p', { class: 'muted', text: hint }), message]);
};

export const messageLine = (): HTMLElement => el('p', { class: 'field-message' });
