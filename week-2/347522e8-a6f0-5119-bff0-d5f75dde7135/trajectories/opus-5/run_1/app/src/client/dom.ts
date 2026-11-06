/** Small DOM helpers. The screens build and patch nodes directly. */

type AttrValue = string | number | boolean | null | undefined;

export interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, AttrValue>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: readonly (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    if (handler) node.addEventListener(name, handler);
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(child);
  }
  return node;
}

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** A labelled form field with its own error slot. */
export function field(
  labelText: string,
  control: HTMLElement,
  id: string,
): { wrapper: HTMLElement; error: HTMLElement } {
  control.id = id;
  const error = el('p', { class: 'field__error', attrs: { id: `${id}-error`, hidden: true } });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { text: labelText, attrs: { for: id } }),
    control,
    error,
  ]);
  return { wrapper, error };
}

export function setFieldError(error: HTMLElement, message: string | null): void {
  if (message === null) {
    error.hidden = true;
    clear(error);
    return;
  }
  error.hidden = false;
  error.replaceChildren(icon('triangle-alert'), el('span', { text: message }));
}

/** The focusable controls inside a container, in document order. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/**
 * Keeps Tab and Shift+Tab inside a container. A native dialog does not wrap on
 * its own, so every dialog installs this.
 */
export function trapFocus(container: HTMLElement): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusables(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhoneBand(): boolean {
  return window.matchMedia('(max-width: 767.98px)').matches;
}
