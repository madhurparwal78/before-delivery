import { el } from '../dom.js';

export interface FieldError {
  readonly id: string;
  readonly message: string;
}

export interface Summary {
  readonly element: HTMLElement;
  show: (errors: readonly FieldError[]) => void;
  hide: () => void;
}

/** The `alert` that heads a rejected form and links to each wrong field. */
export function errorSummary(): Summary {
  const element = el('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: true });
  return {
    element,
    show: (errors) => {
      element.replaceChildren(
        el('h2', { text: 'There is a problem' }),
        el(
          'ul',
          {},
          errors.map((error) =>
            el('li', {}, [el('a', { href: `#${error.id}`, text: error.message, 'data-field': error.id })]),
          ),
        ),
      );
      element.hidden = false;
      element.focus();
      for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a[data-field]')) {
        anchor.addEventListener('click', (event) => {
          event.preventDefault();
          document.getElementById(anchor.dataset['field'] ?? '')?.focus();
        });
      }
    },
    hide: () => {
      element.hidden = true;
      element.replaceChildren();
    },
  };
}

export function markField(input: HTMLElement, errorNode: HTMLElement, message: string | null): void {
  errorNode.textContent = message ?? '';
  if (message === null) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    return;
  }
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', errorNode.id);
}
