// Dialogs, the Menu and the sections sheet. Adapted from kit/modules/a11y_dialog: focus moves in
// on open, Tab stays inside, Escape and Cancel close, and focus returns to a published home.
// The exit is the part the brief pins: the moment closing starts the overlay is inert and focus
// is already home, the opener works at once, and pressing it during the exit reopens it.

import { el, on, prefersReducedMotion } from '../dom.js';

const EXIT_MS = 333;

interface OverlayOptions {
  name: string;
  /** Only the Menu and the sections sheet close on a tap on the scrim. */
  scrimCloses?: boolean;
  sheet?: boolean;
  /** Escape and Cancel are ignored while this returns true. */
  locked?: () => boolean;
  /** Where focus goes when it closes; the opener by default. */
  focusHome?: () => HTMLElement | null;
  onClose?: () => void;
}

export class Overlay {
  readonly box: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly holder: HTMLElement;
  private opener: HTMLElement | null = null;
  private exiting: number | null = null;
  private open = false;
  private readonly options: OverlayOptions;

  constructor(options: OverlayOptions, build: (close: () => void) => Node[]) {
    this.options = options;
    this.box = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
      class: `overlay-box${options.sheet ? ' overlay-sheet' : ''}`,
    });
    this.box.append(...build(() => this.close()));
    this.scrim = el('div', { class: 'overlay-scrim' });
    this.holder = el('div', { class: 'overlay' }, [this.scrim, this.box]);
    on(this.scrim, 'pointerdown', (event) => {
      event.preventDefault();
      if (options.scrimCloses && !this.locked()) this.close();
    });
    on(this.holder, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent));
    on(document, 'keydown', (event) => {
      if (this.open && (event as KeyboardEvent).key === 'Escape' && !this.holder.contains(document.activeElement)) {
        this.onKeyDown(event as KeyboardEvent);
      }
    });
    // The page behind an open overlay does not scroll, and nothing moves to achieve it.
    const hold = (event: Event) => {
      if (this.open) event.preventDefault();
    };
    on(this.holder, 'wheel', hold, { passive: false });
    on(this.holder, 'touchmove', hold, { passive: false });
  }

  private locked(): boolean {
    return this.options.locked?.() ?? false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.locked()) this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = this.focusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !this.box.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !this.box.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  private focusable(): HTMLElement[] {
    return [...this.box.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null || node === document.activeElement);
  }

  show(opener: HTMLElement | null): void {
    if (this.exiting !== null) {
      window.clearTimeout(this.exiting);
      this.exiting = null;
    }
    if (!this.holder.isConnected) document.body.append(this.holder);
    this.holder.removeAttribute('inert');
    this.holder.removeAttribute('aria-hidden');
    this.holder.classList.remove('is-leaving');
    this.open = true;
    if (opener) this.opener = opener;
    // An overlay is already fully in view, so focusing inside it never moves the page.
    const first = this.focusable()[0];
    if (first) first.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    // Inert at once: a press on anything inside reaches nothing and sends nothing.
    this.holder.setAttribute('inert', '');
    this.holder.setAttribute('aria-hidden', 'true');
    const home = this.options.focusHome?.() ?? this.opener;
    if (home && home.isConnected) home.focus();
    this.options.onClose?.();
    const remove = (): void => {
      this.exiting = null;
      if (!this.open) this.holder.remove();
    };
    if (prefersReducedMotion()) {
      remove();
      return;
    }
    this.holder.classList.add('is-leaving');
    this.exiting = window.setTimeout(remove, EXIT_MS);
  }

  /** Removes the overlay with no exit, for a poll that replaces the whole page. */
  destroy(): void {
    this.open = false;
    if (this.exiting !== null) window.clearTimeout(this.exiting);
    this.exiting = null;
    this.holder.remove();
  }
}
