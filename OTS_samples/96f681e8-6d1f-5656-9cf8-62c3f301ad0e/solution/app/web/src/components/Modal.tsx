import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A modal `<dialog>`: Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to the control that
 * opened it.
 */
export function Modal({ labelledBy, onClose, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const returnTo = opener.current;
    return () => {
      if (dialog.open) dialog.close();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = ref.current;
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
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
      className={`modal ${className ?? ""}`}
      aria-labelledby={labelledBy}
      onKeyDown={trap}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      {children}
    </dialog>
  );
}
