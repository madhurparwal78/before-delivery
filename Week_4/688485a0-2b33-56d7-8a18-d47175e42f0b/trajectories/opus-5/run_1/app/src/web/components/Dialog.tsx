import { ReactNode, useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/** Keeps Tab inside, closes on Escape and gives focus back to the opener. */
export function useFocusTrap(
  onClose: () => void,
  restoreFocus = true,
): { ref: React.RefObject<HTMLDivElement>; onKeyDown: (event: React.KeyboardEvent) => void } {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = ref.current ? focusables(ref.current)[0] : null;
    (first ?? ref.current)?.focus();
    return () => {
      if (restoreFocus) opener.current?.focus();
    };
  }, [restoreFocus]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { ref, onKeyDown };
}

export function Dialog({
  label,
  onClose,
  children,
  full = false,
  restoreFocus = true,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
  restoreFocus?: boolean;
}): JSX.Element {
  const trap = useFocusTrap(onClose, restoreFocus);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={full ? 'dialog full' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={trap.onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const trap = useFocusTrap(onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={trap.onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  label,
  confirmLabel,
  onConfirm,
  onCancel,
  restoreFocus = true,
  children,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  restoreFocus?: boolean;
  children?: ReactNode;
}): JSX.Element {
  return (
    <Dialog label={label} onClose={onCancel} restoreFocus={restoreFocus}>
      <h3>{label}</h3>
      {children}
      <div className="dialog-actions">
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
