type Attributes = Record<string, string | number | boolean | null | undefined>;

export type Child = Node | string | null | undefined | Child[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child): void {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return;
  }
  parent.appendChild(typeof children === 'string' ? document.createTextNode(children) : children);
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Node, children: Child): void {
  clear(node);
  append(node, children);
}

export function on<T extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  event: T,
  handler: (event: HTMLElementEventMap[T]) => void,
): void {
  node.addEventListener(event, handler as EventListener);
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  describedBy?: HTMLElement,
): HTMLElement {
  const id = control.id || `field-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: labelText }),
    control,
    describedBy ?? null,
  ]);
  return wrapper;
}

export function fieldError(): HTMLElement {
  return el('p', { class: 'field-error', hidden: true });
}

export function setFieldError(
  control: HTMLElement,
  holder: HTMLElement,
  message: string | null,
): void {
  if (message === null) {
    holder.hidden = true;
    holder.textContent = '';
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
    return;
  }
  if (!holder.id) holder.id = `error-${Math.random().toString(36).slice(2, 10)}`;
  holder.hidden = false;
  holder.textContent = message;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', holder.id);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhoneLayout(): boolean {
  return window.innerWidth < 768;
}
