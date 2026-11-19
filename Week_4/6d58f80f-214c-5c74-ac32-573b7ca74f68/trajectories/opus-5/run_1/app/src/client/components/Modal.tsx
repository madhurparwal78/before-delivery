import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  sheet?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A native modal dialog: Tab cycles inside it, Escape closes it and focus returns to the
 * control that opened it.
 */
export const Modal = ({
  label,
  role = 'dialog',
  sheet = false,
  className = '',
  onClose,
  children,
}: ModalProps): JSX.Element => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (!element.open) element.showModal();
    const first = element.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, [role="tree"] [tabindex="0"], button',
    );
    first?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`${sheet ? 'sheet ' : ''}fade-in ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      {...(role === 'alertdialog' ? { role: 'alertdialog' } : {})}
    >
      {children}
    </dialog>
  );
};
