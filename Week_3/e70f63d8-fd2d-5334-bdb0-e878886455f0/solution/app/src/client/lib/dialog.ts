// Keyboard-complete dialogs, adapted from the kit's a11y_dialog module: Tab and Shift+Tab wrap inside, Escape closes,
// and focus returns to what was focused when the dialog opened (the pad's 0 key when that was the page body).

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

export const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);

/** Where focus goes back to: the opener, or the pad's 0 key when the page body had focus. */
export const rememberFocus = (): HTMLElement | null => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
};

export const restoreFocus = (opener: HTMLElement | null): void => {
  const target = opener && opener.isConnected && !(opener as HTMLButtonElement).disabled ? opener : document.querySelector<HTMLElement>('[data-key="0"]');
  target?.focus();
};

/** Wraps Tab inside `dialog`; returns the key handler to attach to it. */
export const trapTab = (dialog: HTMLElement) => (event: KeyboardEvent): void => {
  if (event.key !== 'Tab') return;
  const items = focusables(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
};
