import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { enter, MOTION } from "./tween.js";

const FOCUSABLE = "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** Moves focus to a container's first control (brief: Interactions, Dialogs). */
export function focusFirst(container: HTMLElement): void {
  container.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
}

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the surrounding modal. */
export const useClose = (): (() => void) => useContext(CloseContext);

interface ModalProps {
  title: string;
  alert?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A native modal <dialog>: opens with showModal, focuses its first control and fades and rises in.
 * Leaving is immediate, so the page under it is usable the moment it closes; Escape closes it and
 * focus returns to the opener.
 */
export function Modal({ title, alert = false, className = "", onClose, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    focusFirst(element);
    const stop = enter(element, 12, MOTION.dialogIn);
    return () => {
      stop();
      if (element.open) element.close();
      opener.current?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal slip ${className}`}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <CloseContext.Provider value={onClose}>
        <h2 id={heading} className="modal-title">{title}</h2>
        {children}
      </CloseContext.Provider>
    </dialog>
  );
}
