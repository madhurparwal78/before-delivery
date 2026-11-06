import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { focusables, wrapTab } from "./focus";

interface ModalProps {
  label: string;
  onClose: () => void;
  /** The control that opened the dialog; focus goes back to it on close. */
  opener: HTMLElement | null;
  initialFocus?: () => HTMLElement | null;
  children: ReactNode;
  wide?: boolean;
}

/** A modal dialog: focus starts inside, Tab wraps, Escape closes, focus returns to the opener. */
export function Modal({ label, onClose, opener, initialFocus, children, wide }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    (initialFocus?.() ?? focusables(dialog)[0] ?? dialog).focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
    // opened once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const dialog = ref.current!;
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={wide ? "modal modal-wide" : "modal"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close.current();
        }
        wrapTab(e, e.currentTarget);
      }}
    >
      <h2 className="modal-title">{label}</h2>
      {children}
    </dialog>
  );
}
