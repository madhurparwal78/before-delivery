import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled") && !el.hasAttribute("hidden"));

interface DialogProps {
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}

/**
 * A modal dialog: focus goes to the first control, Tab and Shift+Tab wrap inside, Escape closes, and focus returns
 * to the element that opened it when the dialog goes away.
 */
export function Dialog({ label, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    focusables(dialog)[0]?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    const dialog = ref.current;
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      class="dialog"
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{label}</h2>
      {children}
    </dialog>
  );
}
