import { useEffect, useRef, type ReactNode } from "react";
import { openDialog } from "./focusTrap.ts";

interface DialogProps {
  /** The dialog's accessible name, for example `Request Logo — Tab`. */
  name: string;
  /** Called when the dialog closes by Escape, Cancel or a backdrop press. */
  onClose: () => void;
  /** A bottom sheet on phones: rises from the lower edge and covers at most two thirds of the screen. */
  sheet?: boolean;
  children: ReactNode;
}

/** A modal dialog mounted only while open. Opens on mount and returns focus to the opener when it unmounts or closes. */
export function Dialog({ name, onClose, sheet = false, children }: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = openDialog(dialog, opener, () => closeRef.current());
    const backdrop = (event: MouseEvent): void => {
      if (event.target === dialog) close();
    };
    dialog.addEventListener("click", backdrop);
    return () => {
      dialog.removeEventListener("click", backdrop);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className={sheet ? "dialog sheet" : "dialog"} aria-label={name}>
      {children}
    </dialog>
  );
}
