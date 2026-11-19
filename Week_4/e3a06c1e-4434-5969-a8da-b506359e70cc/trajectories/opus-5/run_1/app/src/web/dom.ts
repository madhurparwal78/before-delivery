type Attributes = Record<string, string | number | boolean | null | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(child);
  }
  return node;
};

export const clear = (node: Element): void => {
  while (node.firstChild !== null) node.firstChild.remove();
};

export const setText = (node: Element, value: string): void => {
  if (node.textContent !== value) node.textContent = value;
};

export const setAttribute = (node: Element, name: string, value: string): void => {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
};

export const focusables = (root: HTMLElement): HTMLElement[] =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const field = (
  labelText: string,
  control: HTMLElement,
  errorId: string,
): { row: HTMLElement; error: HTMLElement } => {
  const error = el('p', { class: 'field-error', id: errorId, role: 'alert' });
  error.hidden = true;
  const label = el('label', { class: 'field-label' }, [labelText]);
  if (control.id === '') control.id = `${errorId}-control`;
  label.setAttribute('for', control.id);
  return { row: el('div', { class: 'field' }, [label, control, error]), error };
};

export const showFieldError = (control: HTMLElement, error: HTMLElement, message: string | null): void => {
  if (message === null) {
    error.hidden = true;
    error.textContent = '';
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
    return;
  }
  error.hidden = false;
  error.textContent = message;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', error.id);
};
