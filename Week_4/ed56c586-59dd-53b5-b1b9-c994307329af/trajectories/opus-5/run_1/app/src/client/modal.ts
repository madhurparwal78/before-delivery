/** The one modal behaviour shared by the menu and the quick-look dialogs. */

import { focusWithRule, queryAll } from './dom.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface CloseOptions {
  /** A chosen menu link closes the dialog without taking focus back. */
  readonly keepFocus?: boolean;
  readonly immediate?: boolean;
}

export interface Modal {
  readonly open: (opener: HTMLElement, firstFocus: HTMLElement) => void;
  readonly close: (options?: CloseOptions) => void;
  readonly isOpen: () => boolean;
}

const pageParts = (): HTMLElement[] =>
  queryAll<HTMLElement>('.site-header, .site-main, .site-footer, .skip-link');

export interface ModalOptions {
  readonly layer: HTMLElement;
  readonly dialog: HTMLElement;
  readonly backdrop: HTMLElement;
  /** Milliseconds the dialog takes to slide closed, during which it is inert. */
  readonly closeDelayMs?: number;
  readonly onClose?: () => void;
}

export const createModal = (options: ModalOptions): Modal => {
  const { layer, dialog, backdrop } = options;
  let opener: HTMLElement | null = null;
  let closingTimer: number | null = null;

  const isOpen = (): boolean => !layer.hidden && dialog.dataset.state !== 'closing';

  const finishClose = (): void => {
    layer.hidden = true;
    delete dialog.dataset.state;
    dialog.removeAttribute('inert');
    dialog.removeAttribute('aria-hidden');
  };

  const close = (closeOptions: CloseOptions = {}): void => {
    if (layer.hidden) return;
    if (closingTimer !== null) return;
    dialog.dataset.state = 'closing';
    dialog.setAttribute('inert', '');
    dialog.setAttribute('aria-hidden', 'true');
    for (const part of pageParts()) part.removeAttribute('inert');
    options.onClose?.();
    const target = opener;
    opener = null;
    if (target !== null && closeOptions.keepFocus !== true) focusWithRule(target);
    const delay = closeOptions.immediate === true ? 0 : (options.closeDelayMs ?? 0);
    if (delay === 0) {
      finishClose();
      return;
    }
    closingTimer = window.setTimeout(() => {
      closingTimer = null;
      finishClose();
    }, delay);
  };

  const open = (nextOpener: HTMLElement, firstFocus: HTMLElement): void => {
    if (closingTimer !== null) {
      window.clearTimeout(closingTimer);
      closingTimer = null;
    }
    opener = nextOpener;
    layer.hidden = false;
    delete dialog.dataset.state;
    dialog.removeAttribute('inert');
    dialog.removeAttribute('aria-hidden');
    for (const part of pageParts()) part.setAttribute('inert', '');
    firstFocus.focus({ preventScroll: true });
  };

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = queryAll<HTMLElement>(FOCUSABLE, dialog);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  });

  backdrop.addEventListener('click', () => close());

  return { open, close, isOpen };
};
