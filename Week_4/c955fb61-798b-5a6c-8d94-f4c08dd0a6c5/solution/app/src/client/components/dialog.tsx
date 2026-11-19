import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface Props {
  label: string;
  className?: string;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the control that opened it. */
  returnTo: () => HTMLElement | null;
  children: ReactNode;
}

/** A modal dialog on the native element: Tab and Shift+Tab wrap inside it, Escape closes it, focus returns to its opener. */
export function Dialog({ label, className, onClose, returnTo, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnRef = useRef(returnTo);
  returnRef.current = returnTo;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog.close();
      returnRef.current()?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement === edge || !event.currentTarget.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={className}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
