// Adapted from kit/modules/a11y_dialog: a modal that keeps Tab inside, closes on Escape and returns focus.

function isFocusable(el: Element): boolean {
  if (el.hasAttribute('disabled') || el.hasAttribute('hidden') || el.hasAttribute('inert')) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href');
  if (tag === 'input') return el.getAttribute('type') !== 'hidden';
  return ['button', 'select', 'textarea', 'summary'].includes(tag);
}

const focusables = (root: Element) => [...root.querySelectorAll('*')].filter(isFocusable) as HTMLElement[];

/** Opens `dialog` with showModal(), traps focus inside and calls `onEscape` for Escape. Returns the release. */
export function trapDialog(dialog: HTMLDialogElement, onEscape: () => void): (returnTo: HTMLElement | null) => void {
  dialog.showModal();
  const items = focusables(dialog);
  (items.find((el) => el.hasAttribute('data-autofocus')) ?? items[0] ?? dialog).focus();

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    } else if (event.key === 'Tab') {
      const els = focusables(dialog);
      if (!els.length) return event.preventDefault();
      const edge = event.shiftKey ? els[0] : els[els.length - 1];
      const active = document.activeElement;
      if (active === edge || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? els[els.length - 1] : els[0]).focus();
      }
    }
  };
  const onCancel = (event: Event) => {
    event.preventDefault();
    onEscape();
  };
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('cancel', onCancel);
  return (returnTo) => {
    dialog.removeEventListener('keydown', onKey);
    dialog.removeEventListener('cancel', onCancel);
    if (dialog.open) dialog.close();
    if (returnTo?.isConnected) returnTo.focus();
  };
}
