// Tiny DOM builder. Attributes with on* are listeners; children are nodes,
// strings or arrays.
export type Child = Node | string | null | undefined | false | Child[];
export type Attrs = Record<string, unknown>;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        el.setAttribute(`data-${dk}`, dv);
      }
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(el, child);
    } else if (typeof child === 'string') {
      el.append(document.createTextNode(child));
    } else {
      el.append(child);
    }
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

export function button(label: string, attrs: Attrs = {}, ...children: Child[]): HTMLButtonElement {
  const el = h('button', { type: 'button', ...attrs }, ...children) as HTMLButtonElement;
  if (el.getAttribute('aria-label') === null && children.length === 0) el.setAttribute('aria-label', label);
  return el;
}

export function heading(level: number, attrs: Attrs, text: string): HTMLHeadingElement {
  const el = h(`h${level}`, attrs, text) as HTMLHeadingElement;
  return el;
}

export function fieldErrorLink(name: string, message: string, target: string): HTMLElement {
  return h('a', { href: `#${target}`, class: 'problem-link', onclick: (e: Event) => {
    e.preventDefault();
    const el = document.getElementById(target);
    if (el !== null) {
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      focusElement(el);
    }
  } }, `${name}: ${message}`);
}

export function focusElement(el: HTMLElement): void {
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
}

export function text(t: string): Text {
  return document.createTextNode(t);
}

export function inputText(attrs: Record<string, unknown> = {}): HTMLInputElement {
  return h('input', { type: 'text', ...attrs }) as HTMLInputElement;
}

export function selectEl(attrs: Record<string, unknown> = {}, options: (HTMLElement | string)[] = []): HTMLSelectElement {
  const el = h('select', attrs, options) as HTMLSelectElement;
  return el;
}

export function radioGroup(name: string, options: { value: string; label: string; checked: boolean }[]): HTMLFieldSetElement {
  const fieldset = h('fieldset', { role: 'radiogroup', class: 'radio-group' }) as HTMLFieldSetElement;
  fieldset.setAttribute('aria-label', name);
  for (const opt of options) {
    const id = `${name}-${opt.value}`.replace(/\s+/g, '-').toLowerCase();
    const input = h('input', { type: 'radio', id, name, value: opt.value, ...(opt.checked ? { checked: true } : {}) });
    fieldset.append(h('label', { for: id, class: 'radio-label' }, input, h('span', {}, opt.label)));
  }
  return fieldset;
}

export function radioValue(name: string): string | null {
  const checked = document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null;
  return checked !== null ? checked.value : null;
}

export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined || false as unknown as boolean) continue;
    if (Array.isArray(child)) {
      for (const c of child) if (typeof c === 'string') frag.append(c); else if (c instanceof Node) frag.append(c);
    } else if (typeof child === 'string') frag.append(child);
    else if (child instanceof Node) frag.append(child);
  }
  return frag;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
