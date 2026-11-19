import { h } from './dom.js';

export interface DialogOptions {
  readonly label: string;
  readonly className?: string;
  readonly onClose?: () => void;
}

export class Dialog {
  readonly element: HTMLDialogElement;
  private opener: HTMLElement | null = null;
  private readonly onClose: (() => void) | undefined;

  constructor(options: DialogOptions) {
    this.element = h('dialog', {
      'aria-label': options.label,
      class: options.className ?? '',
    });
    this.onClose = options.onClose;
    this.element.addEventListener('close', () => {
      this.onClose?.();
      const opener = this.opener;
      this.opener = null;
      if (opener !== null && opener.isConnected) opener.focus();
    });
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  open(opener: HTMLElement | null, firstFocus?: HTMLElement | null): void {
    this.opener = opener;
    if (!this.element.open) this.element.showModal();
    const target = firstFocus ?? this.element.querySelector<HTMLElement>('input, select, button');
    target?.focus();
  }

  close(): void {
    if (this.element.open) this.element.close();
  }
}
