import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A dialog that traps focus: opens with focus on its first field (or first
 * button), Tab and Shift+Tab cycle inside, everything behind is inert, and
 * Escape or Cancel returns focus to the control that opened it.
 */
export function Dialog(props: {
  label: string;
  onClose: () => void;
  returnRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  wide?: boolean;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
    const first = focusables[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        props.returnRef?.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const currentFocusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])')
      ).filter((element) => !element.hasAttribute('disabled'));
      if (currentFocusables.length === 0) return;
      const firstEl = currentFocusables[0];
      const lastEl = currentFocusables[currentFocusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === firstEl || !dialog.contains(active)) {
          event.preventDefault();
          lastEl.focus();
        }
      } else {
        if (active === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
    };
  }, [props]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        className={`paper slip dialog${props.wide ? ' wide' : ''}`}
      >
        {props.children}
      </div>
    </div>
  );
}
