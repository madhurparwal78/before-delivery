import { el, prefersReducedMotion } from './dom';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogOptions {
  title: string;
  opener: HTMLElement | null;
  /** Cancel booking, Check out and Buy dialogs keep their place under Sign in again. */
  blocking?: boolean;
  onEscape?: () => void;
  focusOnClose?: () => HTMLElement | null;
}

let layer: HTMLElement | null = null;

function dialogLayer(): HTMLElement {
  if (layer === null) {
    layer = el('div', { class: 'dialog-layer' });
    document.body.append(layer);
  }
  return layer;
}

export class Dialog {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private readonly options: DialogOptions;
  private openState = false;
  private readonly veil: HTMLElement;

  constructor(options: DialogOptions) {
    this.options = options;
    this.veil = el('div', { class: 'dialog-veil' });
    this.element = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title,
      class: `dialog${prefersReducedMotion() ? ' no-motion' : ''}`,
    });
    this.body = el('div', { class: 'dialog-body' });
    this.element.append(this.body);
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(focusTarget?: HTMLElement | null): void {
    if (this.openState) return;
    this.openState = true;
    const host = dialogLayer();
    host.append(this.veil, this.element);
    document.getElementById('app')?.setAttribute('inert', '');
    const target =
      focusTarget ?? (this.element.querySelector(FOCUSABLE) as HTMLElement | null);
    target?.focus();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.veil.remove();
    this.element.remove();
    if (dialogLayer().children.length === 0) {
      document.getElementById('app')?.removeAttribute('inert');
    }
    const fallback = this.options.focusOnClose?.() ?? null;
    const opener = this.options.opener;
    if (opener !== null && document.body.contains(opener)) opener.focus();
    else fallback?.focus();
  }

  /** Dims and freezes this dialog while Sign in again sits over it. */
  setInert(inert: boolean): void {
    if (inert) {
      this.element.setAttribute('inert', '');
      this.element.classList.add('dimmed');
    } else {
      this.element.removeAttribute('inert');
      this.element.classList.remove('dimmed');
    }
  }

  focusedControl(): HTMLElement | null {
    const active = document.activeElement as HTMLElement | null;
    if (active !== null && this.element.contains(active)) return active;
    return null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.options.onEscape !== undefined) this.options.onEscape();
      else this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(this.element.querySelectorAll(FOCUSABLE)) as HTMLElement[];
    const visible = focusable.filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (visible.length === 0) return;
    const first = visible[0] as HTMLElement;
    const last = visible[visible.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
