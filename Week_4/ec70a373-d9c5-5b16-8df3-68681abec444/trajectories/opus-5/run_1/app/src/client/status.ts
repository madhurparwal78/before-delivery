import { el } from './dom';

/**
 * A status region: polite, atomic, present and empty in the first frame, and written as
 * one whole-text update per copy.
 */
export class StatusRegion {
  readonly element: HTMLElement;
  private current = '';

  constructor(name: string) {
    this.element = el('p', {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'aria-label': name,
      class: 'status-region',
    });
  }

  write(text: string): void {
    if (text === this.current) {
      this.element.textContent = '';
      requestAnimationFrame(() => {
        this.element.textContent = text;
      });
      return;
    }
    this.current = text;
    this.element.textContent = text;
  }

  /** Writes only when the copy differs, so an unchanged region gets no DOM change. */
  writeIfChanged(text: string): void {
    if (text === this.current) return;
    this.current = text;
    this.element.textContent = text;
  }

  /** Writes rich text (used only by the cancellation outcome's flame forfeit part). */
  writeNodes(text: string, nodes: Node[]): void {
    if (text === this.current) return;
    this.current = text;
    this.element.textContent = '';
    for (const node of nodes) this.element.append(node);
  }

  text(): string {
    return this.current;
  }
}

export interface FieldErrorHost {
  field: HTMLElement;
  container: HTMLElement;
}

let fieldErrorCounter = 0;

/** Field errors sit directly after their field and are linked to it. */
export function showFieldError(field: HTMLElement, message: string): void {
  clearFieldError(field);
  fieldErrorCounter += 1;
  const id = `field-error-${fieldErrorCounter}`;
  const error = el('p', { class: 'field-error', id, text: message });
  field.insertAdjacentElement('afterend', error);
  field.setAttribute('aria-invalid', 'true');
  const describedBy = field.getAttribute('aria-describedby');
  field.setAttribute('aria-describedby', describedBy === null ? id : `${describedBy} ${id}`);
  const clearOnChange = (): void => {
    clearFieldError(field);
    field.removeEventListener('input', clearOnChange);
    field.removeEventListener('change', clearOnChange);
  };
  field.addEventListener('input', clearOnChange);
  field.addEventListener('change', clearOnChange);
}

export function clearFieldError(field: HTMLElement): void {
  const next = field.nextElementSibling;
  if (next !== null && next.classList.contains('field-error')) {
    const id = next.id;
    next.remove();
    const describedBy = field.getAttribute('aria-describedby');
    if (describedBy !== null) {
      const remaining = describedBy
        .split(/\s+/)
        .filter((candidate) => candidate !== id)
        .join(' ');
      if (remaining === '') field.removeAttribute('aria-describedby');
      else field.setAttribute('aria-describedby', remaining);
    }
  }
  field.removeAttribute('aria-invalid');
}
