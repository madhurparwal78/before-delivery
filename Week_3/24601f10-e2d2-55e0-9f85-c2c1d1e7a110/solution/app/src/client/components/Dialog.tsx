import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

// A modal dialog: native <dialog>, Tab wraps inside it, Escape closes it, focus returns to the opener
// (adapted from the kit's a11y_dialog module).
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
    .filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0
      && (el as HTMLInputElement).type !== 'hidden');
}

export function Dialog({ label, onClose, children, className }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(dialog)[0] ?? dialog).focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    const dialog = event.currentTarget;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return event.preventDefault();
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <dialog ref={ref} aria-label={label} className={`dialog ${className ?? ''}`} onKeyDown={onKeyDown}
      onCancel={(event) => event.preventDefault()}>
      <h2 className="dialog-title">{label}</h2>
      {children}
    </dialog>
  );
}
