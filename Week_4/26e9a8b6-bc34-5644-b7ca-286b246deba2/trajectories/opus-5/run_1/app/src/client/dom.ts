import { MOTION } from '../shared/scrollmap.js';

export function byLabel<T extends HTMLElement>(label: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(`[aria-label="${CSS.escape(label)}"]`);
}

export function need<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element ${selector}`);
  return element;
}

/** A polite live region: set its text and let it announce. */
export class Status {
  private readonly element: HTMLElement | null;
  private clearHandle: number | null = null;

  constructor(label: string, root: ParentNode = document) {
    this.element = byLabel<HTMLElement>(label, root);
  }

  say(message: string): void {
    if (this.element === null) return;
    this.element.textContent = message;
    this.cancelClear();
  }

  /**
   * An outcome clears after the published notice time; a newer message
   * restarts that timer and an older timer never clears a newer message.
   */
  sayAndClear(message: string, after: number = MOTION.noticeClear): void {
    this.say(message);
    const element = this.element;
    if (element === null) return;
    this.clearHandle = window.setTimeout(() => {
      this.clearHandle = null;
      if (element.textContent === message) element.textContent = '';
    }, after);
  }

  clear(): void {
    this.cancelClear();
    if (this.element !== null) this.element.textContent = '';
  }

  private cancelClear(): void {
    if (this.clearHandle !== null) {
      window.clearTimeout(this.clearHandle);
      this.clearHandle = null;
    }
  }
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/** Tab and Shift+Tab wrap inside a dialog; Escape returns focus to its opener. */
export class Dialog {
  private opener: HTMLElement | null = null;

  constructor(readonly element: HTMLElement) {
    element.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(element);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    for (const button of element.querySelectorAll<HTMLElement>('[data-action="cancel"]')) {
      button.addEventListener('click', () => this.close());
    }
  }

  open(opener: HTMLElement | null): void {
    this.opener = opener;
    this.element.hidden = false;
    focusableIn(this.element)[0]?.focus();
  }

  close(): void {
    this.element.hidden = true;
    this.opener?.focus();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }
}

/** Finds a dialog by its accessible name, never a button of the same name. */
export function dialogNamed(label: string): Dialog | null {
  const element = document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${CSS.escape(label)}"],[role="alertdialog"][aria-label="${CSS.escape(label)}"]`,
  );
  return element === null ? null : new Dialog(element);
}

export function requireDialog(label: string): Dialog {
  const dialog = dialogNamed(label);
  if (dialog === null) throw new Error(`missing dialog ${label}`);
  return dialog;
}

export function setDisabled(button: HTMLElement, disabled: boolean): void {
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

export function isDisabled(button: HTMLElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

/** Keeps `--vh` equal to the window's height so the mapping uses the real H. */
export function trackViewportHeight(): void {
  const apply = (): void => {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}

/**
 * Publishes the measured heights of the wordmark and the reader bar, so the
 * panes below them never sit under a bar that has wrapped.
 */
export function trackBarHeights(): void {
  const apply = (): void => {
    const wordmark = document.querySelector<HTMLElement>('.wordmark');
    const bar = document.querySelector<HTMLElement>('.reader-bar');
    const root = document.documentElement;
    root.style.setProperty(
      '--wordmark-height',
      wordmark === null ? '0px' : `${Math.ceil(wordmark.getBoundingClientRect().bottom) + 8}px`,
    );
    root.style.setProperty(
      '--bar-height',
      bar === null ? '0px' : `${Math.ceil(bar.getBoundingClientRect().height)}px`,
    );
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (document.fonts !== undefined) void document.fonts.ready.then(apply);
}
