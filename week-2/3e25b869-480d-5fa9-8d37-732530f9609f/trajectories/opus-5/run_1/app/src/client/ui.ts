import type { Bilingual } from '../shared/catalog.js';
import { locale } from './i18n.js';

type Attributes = Record<string, string | number | boolean | null | undefined>;

export type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
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
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(tag: string, attributes: Attributes = {}, children: readonly Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node as SVGElement;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

type Binding = () => void;

let bindings: Binding[] = [];

/** Registers a live piece of the page; it runs now and again on every refresh. */
export function bind(update: Binding): void {
  bindings.push(update);
  update();
}

export function refresh(): void {
  for (const update of bindings) update();
}

export function resetBindings(): void {
  bindings = [];
}

/** Binds an element's text to a bilingual or computed string. */
export function bindText(node: Element, read: () => string): void {
  bind(() => {
    const next = read();
    if (node.textContent !== next) node.textContent = next;
  });
}

export function say(text: Bilingual): string {
  return text[locale()];
}

export function labelled(text: Bilingual, control: HTMLElement, options: { hint?: Bilingual } = {}): HTMLElement {
  const id = control.id || `field-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  const label = el('label', { class: 'field-label', for: id });
  bindText(label, () => say(text));
  const wrapper = el('div', { class: 'field' }, [label, control]);
  if (options.hint) {
    const hint = el('p', { class: 'field-hint' });
    bindText(hint, () => say(options.hint as Bilingual));
    wrapper.append(hint);
  }
  return wrapper;
}

export function setFieldError(control: HTMLElement, message: HTMLElement, text: string | null): void {
  if (text === null) {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
    message.textContent = '';
    message.hidden = true;
    return;
  }
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', message.id);
  message.textContent = text;
  message.hidden = false;
}

export function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => !node.hasAttribute('disabled'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
