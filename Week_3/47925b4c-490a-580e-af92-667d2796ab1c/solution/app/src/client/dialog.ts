const NATIVELY_FOCUSABLE = new Set(['button', 'select', 'textarea', 'summary', 'iframe']);

function isFocusable(node: Element): boolean {
  if (node.hasAttribute('disabled') || node.hasAttribute('hidden') || node.hasAttribute('inert')) return false;
  const tabindex = node.getAttribute('tabindex');
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = node.tagName.toLowerCase();
  if (tag === 'a' || tag === 'area') return node.hasAttribute('href');
  if (tag === 'input') return node.getAttribute('type') !== 'hidden';
  return NATIVELY_FOCUSABLE.has(tag);
}

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll('*')].filter(isFocusable) as HTMLElement[];
}

/** Where focus returns: an element, or a lookup for one that may have been redrawn while the dialog was open. */
export type Opener = HTMLElement | (() => HTMLElement | null) | null;

interface OpenDialog {
  readonly close: () => void;
}

/**
 * The APG modal dialog pattern on a native `<dialog>`: focus moves in, Tab and Shift+Tab wrap
 * inside, Escape closes, and focus returns to the opener when it does.
 */
export function openDialog(
  dialog: HTMLDialogElement,
  opener: Opener,
  onClose: () => void | Promise<void>,
): OpenDialog {
  dialog.showModal();
  const items = focusables(dialog);
  (items.find((node) => node.hasAttribute('autofocus')) ?? items[0] ?? dialog).focus();

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const inside = focusables(dialog);
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const edge = event.shiftKey ? first : last;
    if (active === edge || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  const onCancel = (event: Event): void => {
    event.preventDefault();
    close();
  };
  let open = true;
  function close(): void {
    if (!open) return;
    open = false;
    dialog.removeEventListener('keydown', onKey);
    dialog.removeEventListener('cancel', onCancel);
    void Promise.resolve(onClose()).then(() => (typeof opener === 'function' ? opener() : opener)?.focus());
  }
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('cancel', onCancel);
  return { close };
}
