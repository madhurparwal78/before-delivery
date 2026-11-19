import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'button:not([disabled]):not([aria-disabled="true"]), [href], input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

interface DialogProps {
  readonly label: string;
  readonly role?: 'dialog' | 'alertdialog';
  readonly onEscape: () => void;
  readonly children: ReactNode;
  /** The dialog on top takes the Tab trap; the one below keeps its contents. */
  readonly inert?: boolean;
  readonly className?: string;
}

/**
 * Keeps focus inside the dialog, wrapping at both ends, through every refresh
 * and poll, and hands Escape back to the caller.
 */
export function Dialog({
  label,
  role = 'dialog',
  onEscape,
  children,
  inert = false,
  className,
}: DialogProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null);

  // Focus starts on the dialog's first control, once any dialog below has gone inert.
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    focusableIn(root)[0]?.focus();
  }, []);

  useEffect(() => {
    if (inert) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const root = box.current;
      if (!root) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = focusableIn(root);
      if (stops.length === 0) return;
      const first = stops[0] as HTMLElement;
      const last = stops[stops.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onEscape, inert]);

  useEffect(() => {
    if (inert) return undefined;
    // A poll that moves focus out of the dialog is pulled straight back in.
    const guard = (event: FocusEvent): void => {
      const root = box.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && !root.contains(target)) {
        const stops = focusableIn(root);
        stops[0]?.focus();
      }
    };
    document.addEventListener('focusin', guard);
    return () => document.removeEventListener('focusin', guard);
  }, [inert]);

  return (
    <div className="dialog-shade">
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-label={label}
        className={`dialog ${className ?? ''}`}
      >
        {children}
      </div>
    </div>
  );
}
