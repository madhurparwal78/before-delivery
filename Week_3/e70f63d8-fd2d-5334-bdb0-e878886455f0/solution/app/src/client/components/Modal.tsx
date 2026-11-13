import type { ComponentChildren, JSX } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { focusables, rememberFocus, restoreFocus, trapTab } from '../lib/dialog.js';

interface ModalProps {
  title: string;
  onClose: () => void;
  /** Selector of the control that takes focus when the dialog opens; the first control otherwise. */
  initialFocus?: string;
  children: ComponentChildren;
}

/** A modal native dialog named by its heading. It exists only while open, so every opening starts fresh. */
export const Modal = ({ title, onClose, initialFocus, children }: ModalProps): JSX.Element => {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = rememberFocus();
    dialog.showModal();
    (initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null)?.focus();
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog) focusables(dialog)[0]?.focus();
    const tab = trapTab(dialog);
    const cancel = (event: Event): void => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener('keydown', tab);
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('keydown', tab);
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      restoreFocus(opener);
    };
  }, []);

  return (
    <dialog ref={ref} class="dialog" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </dialog>
  );
};
