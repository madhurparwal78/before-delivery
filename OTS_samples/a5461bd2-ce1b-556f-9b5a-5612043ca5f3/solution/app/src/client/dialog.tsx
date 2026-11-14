import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface ModalProps {
  label: string;
  className: string;
  onClose: () => void;
  /** The element that takes focus when the dialog opens. */
  initialFocus: (dialog: HTMLDialogElement) => HTMLElement | null;
  children: ReactNode;
}

/** A modal dialog: Tab and Shift+Tab wrap inside it, Escape asks to close, and the page behind is inert. */
export function ModalDialog({ label, className, onClose, initialFocus, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    dialog.showModal();
    initialFocus(dialog)?.focus({ preventScroll: true });
    return () => dialog.close();
  }, [initialFocus]);

  const wrap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
    const [first, last] = [items[0], items[items.length - 1]];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={wrap}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
