import { useEffect, useId, useRef } from "react";
import { EASE, reducedMotion } from "../seam";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A modal dialog (native `<dialog>`): focus stays inside, Escape closes it, and focus returns to the control
 * that opened it.
 */
export function Modal({ title, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closed = useRef(onClose);
  closed.current = onClose;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    if (!reducedMotion()) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE });
    const onCloseEvent = () => closed.current();
    element.addEventListener("close", onCloseEvent);
    return () => {
      element.removeEventListener("close", onCloseEvent);
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialog} className="modal" aria-labelledby={titleId}>
      <h2 id={titleId} className="modal-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
