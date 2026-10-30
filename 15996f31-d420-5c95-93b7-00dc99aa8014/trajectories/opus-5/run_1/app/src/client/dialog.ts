import { ApiFailure, el, reducedMotion } from './core';
import { ErrorSummary, FormField, applyFieldMessages } from './forms';

const LEAVE_MS = 170;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogSpec {
  name: string;
  opener: HTMLElement;
  fields: readonly FormField[];
  extra?: readonly Node[];
  submitLabel: string;
  closeLabel?: string;
  submit: (dialog: Dialog) => Promise<void>;
}

/** A modal dialog that holds focus, closes on Escape and returns focus home. */
export class Dialog {
  readonly element: HTMLElement;
  readonly submitButton: HTMLButtonElement;
  readonly summary = new ErrorSummary();
  private readonly backdrop: HTMLElement;
  private readonly spec: DialogSpec;
  private closed = false;

  constructor(spec: DialogSpec) {
    this.spec = spec;
    this.submitButton = el('button', {
      type: 'submit',
      class: 'button button--primary',
      text: spec.submitLabel,
    });
    const close = el('button', {
      type: 'button',
      class: 'button button--quiet',
      text: spec.closeLabel ?? 'Close',
    });
    close.addEventListener('click', () => this.close());

    const form = el('form', { class: 'dialog__form', novalidate: true }, [
      this.summary.element,
      ...spec.fields.map((field) => field.wrapper),
      ...(spec.extra ?? []),
      el('div', { class: 'dialog__actions' }, [this.submitButton, close]),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void spec.submit(this);
    });

    this.element = el(
      'div',
      {
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': spec.name,
      },
      [el('h2', { class: 'dialog__title', text: spec.name }), form],
    );
    this.backdrop = el('div', { class: 'dialog-layer' }, [this.element]);
    if (reducedMotion()) this.backdrop.dataset.motion = 'none';
    this.backdrop.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  open(): void {
    document.body.append(this.backdrop);
    requestAnimationFrame(() => this.backdrop.classList.add('dialog-layer--open'));
    const first = this.spec.fields[0];
    if (first !== undefined) first.focus();
    else this.submitButton.focus();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.backdrop.classList.remove('dialog-layer--open');
    const finish = (): void => {
      this.backdrop.remove();
      this.spec.opener.focus();
    };
    if (reducedMotion()) finish();
    else window.setTimeout(finish, LEAVE_MS);
  }

  /** Keeps a 422 open with its messages beside each field and in the summary. */
  showFailure(failure: ApiFailure, fallback: string | null = null): void {
    if (failure.status === 422 && failure.fields !== null) {
      applyFieldMessages(this.spec.fields, this.summary, failure.fields);
      return;
    }
    if (fallback !== null) {
      applyFieldMessages(this.spec.fields, this.summary, {
        [this.spec.fields[0]?.name ?? 'form']: fallback,
      });
    }
  }

  clearErrors(): void {
    for (const field of this.spec.fields) field.setError(null);
    this.summary.hide();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/** A slide-over drawer for the orchard rail at narrow widths. */
export class Drawer {
  readonly element: HTMLElement;
  private readonly panel: HTMLElement;
  private open = false;

  constructor(
    private readonly toggle: HTMLButtonElement,
    private readonly content: HTMLElement,
    private readonly restore: () => void,
  ) {
    this.panel = el('div', { class: 'drawer__panel' });
    this.element = el('div', { class: 'drawer' }, [this.panel]);
    if (reducedMotion()) this.element.dataset.motion = 'none';
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.hide();
    });
    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.hide();
    });
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.panel.append(this.content);
    document.body.append(this.element);
    requestAnimationFrame(() => this.element.classList.add('drawer--open'));
    this.toggle.setAttribute('aria-expanded', 'true');
    this.content.querySelector<HTMLElement>('a')?.focus();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.element.classList.remove('drawer--open');
    const finish = (): void => {
      this.element.remove();
      this.restore();
      this.toggle.focus();
    };
    if (reducedMotion()) finish();
    else window.setTimeout(finish, LEAVE_MS);
  }

  get isOpen(): boolean {
    return this.open;
  }
}
