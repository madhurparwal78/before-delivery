/**
 * Dialogs, which become bottom sheets on phones. Focus is trapped while open,
 * lands on the first field, and returns to the control that opened the dialog.
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { focusWhenReady } from '../lib/focus.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}): JSX.Element {
  const headingId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const node = panel.current;
    if (node) {
      const first = focusableIn(node)[0];
      if (first) first.focus();
    }
    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = panel.current;
      if (!node) return;
      const candidates = focusableIn(node);
      if (candidates.length === 0) return;
      const first = candidates[0] as HTMLElement;
      const last = candidates[candidates.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className="dialog-scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog-title" id={headingId}>
          {title}
        </h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{footer}</div>
      </div>
    </div>
  );
}

/** Moves focus to a dialog's first button when a refusal names no field. */
export function focusFirstDialogButton(): void {
  focusWhenReady('[role="dialog"] button');
}
