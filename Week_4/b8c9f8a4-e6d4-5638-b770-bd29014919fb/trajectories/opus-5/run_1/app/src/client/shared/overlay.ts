import { el, focusTarget, focusableWithin } from './dom';
import { prefersReducedMotion } from './motion';

export const EXIT_MS = 330;

export interface OverlayOptions {
  /** The accessible name of the dialog. */
  name: string;
  /** Extra class on the dialog element. */
  variant: string;
  /** The control that opened it, which focus returns to unless a focus home overrides it. */
  opener: HTMLElement | null;
  /** A tap on the scrim closes only the Menu and the sections sheet. */
  scrimCloses: boolean;
  /** `dialog "Sign in again"` ignores Escape and closes only on a successful sign-in. */
  ignoresEscape?: boolean;
  /** Called when the overlay has closed, after focus has gone to its home. */
  onClosed?: () => void;
}

export interface Overlay {
  readonly dialog: HTMLElement;
  readonly body: HTMLElement;
  readonly status: HTMLElement;
  readonly open: boolean;
  readonly exiting: boolean;
  close(focusHome?: HTMLElement | null): void;
  /** Drops an overlay that is playing its exit, so its opener can reopen it. */
  cancelExit(): void;
  /** True while a request inside the dialog is pending, which holds Escape. */
  hasPendingRequest(): boolean;
}

let host: HTMLElement | null = null;

const overlayHost = (): HTMLElement => {
  if (host === null) {
    host = el('div', { class: 'overlay-host' });
    document.body.append(host);
  }
  return host;
};

const liveOverlays: Overlay[] = [];

/**
 * While an overlay is open the page behind does not scroll. Blocking the gestures
 * leaves the scroll position and the layout alone, so opening or closing an overlay
 * fires no scroll event and draws no frame.
 */
const blockPageScroll = (event: Event): void => {
  if (!anyOverlayOpen()) return;
  const target = event.target as Node | null;
  if (target !== null && host !== null && host.contains(target)) return;
  event.preventDefault();
};

let scrollBlockBound = false;
const bindScrollBlock = (): void => {
  if (scrollBlockBound) return;
  scrollBlockBound = true;
  document.addEventListener('wheel', blockPageScroll, { passive: false });
  document.addEventListener('touchmove', blockPageScroll, { passive: false });
};

export const topOverlay = (): Overlay | null => {
  for (let i = liveOverlays.length - 1; i >= 0; i -= 1) {
    if (liveOverlays[i].open) return liveOverlays[i];
  }
  return null;
};

export const anyOverlayOpen = (): boolean => topOverlay() !== null;

/**
 * Opens an overlay. It sits above every fixed bar, keeps Tab inside itself, and the
 * page behind does not scroll.
 */
export const openOverlay = (options: OverlayOptions): Overlay => {
  const status = el('div', { class: 'dialog-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
  const body = el('div', { class: 'dialog-body' });
  const dialog = el('div', {
    class: `dialog dialog-${options.variant}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.name,
  });
  dialog.append(body, status);
  status.setAttribute('aria-label', 'Dialog status');

  const scrim = el('div', { class: 'overlay-scrim' });
  const frame = el('div', { class: `overlay overlay-${options.variant}` }, [scrim, dialog]);
  overlayHost().append(frame);
  bindScrollBlock();
  document.body.classList.add('overlay-open');

  let open = true;
  let exiting = false;
  let exitTimer: number | null = null;

  const finishExit = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    exiting = false;
    if (exitTimer !== null) window.clearTimeout(exitTimer);
    exitTimer = null;
    frame.remove();
    const index = liveOverlays.indexOf(self);
    if (index >= 0) liveOverlays.splice(index, 1);
    if (!anyOverlayOpen() && liveOverlays.every((entry) => !entry.exiting)) {
      document.body.classList.remove('overlay-open');
    }
  };

  const self: Overlay = {
    dialog,
    body,
    status,
    get open() {
      return open;
    },
    get exiting() {
      return exiting;
    },
    hasPendingRequest: () => dialog.querySelector('[data-pending="true"]') !== null,
    close(focusHome?: HTMLElement | null) {
      if (!open) return;
      open = false;
      // The moment closing starts the overlay is inert, so a press inside it reaches nothing.
      dialog.setAttribute('inert', '');
      dialog.setAttribute('aria-hidden', 'true');
      frame.classList.add('overlay-exiting');
      const home = focusHome === undefined ? options.opener : focusHome;
      if (home !== null && home !== undefined && home.isConnected) focusTarget(home);
      else document.body.focus();

      const finish = (): void => {
        finishExit();
        options.onClosed?.();
      };

      if (prefersReducedMotion()) {
        finish();
        return;
      }
      exiting = true;
      exitTimer = window.setTimeout(finish, EXIT_MS);
    },
    cancelExit: finishExit,
  };

  /**
   * Escape and the Tab trap are watched on the document, so they still work when the
   * dialog has replaced the control that held focus.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open || topOverlay() !== self) return;
    if (event.key === 'Escape') {
      if (options.ignoresEscape === true) return;
      if (self.hasPendingRequest()) return;
      event.preventDefault();
      self.close();
      return;
    }
    if (event.key !== 'Tab') return;
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      focusFirstControl(self);
      return;
    }
    const focusables = focusableWithin(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  if (options.scrimCloses) {
    scrim.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (self.hasPendingRequest()) return;
      self.close();
    });
  } else {
    scrim.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  liveOverlays.push(self);
  return self;
};

/** Focus the overlay's first control once its content is in place. */
export const focusFirstControl = (overlay: Overlay): void => {
  const focusables = focusableWithin(overlay.dialog);
  if (focusables.length > 0) focusables[0].focus();
  else focusTarget(overlay.dialog);
};
