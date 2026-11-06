import { useEffect, useRef, type RefObject } from 'react';

// Focus handling for hand-built dialogs (adapted from kit/modules/a11y_dialog):
// focus moves in on open, Tab cycles inside, Escape answers, focus returns on close.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.closest('[inert]'));
}

export function useDialogFocus(
  dialog: RefObject<HTMLElement | null>,
  initial: RefObject<HTMLElement | null>,
  onEscape: () => void,
  returnTo: () => HTMLElement | null,
): void {
  const answers = useRef({ onEscape, returnTo });
  useEffect(() => {
    answers.current = { onEscape, returnTo };
  });
  useEffect(() => {
    const root = dialog.current;
    if (!root) return undefined;
    initial.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        answers.current.onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      answers.current.returnTo()?.focus();
    };
  }, [dialog, initial]);
}
