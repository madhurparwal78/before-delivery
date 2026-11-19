import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
}

/**
 * Modal behaviour shared by dialogs and the tablet sheet: the rest of the app becomes inert, focus moves to the
 * first control, Tab and Shift+Tab wrap inside, Escape closes, and focus returns to the control that opened it.
 * Everything is driven by effects and a document keydown, never by timers (the page clock may be paused).
 */
export function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById('root');
    app?.setAttribute('inert', '');
    const modal = ref.current;
    if (modal) (focusables(modal)[0] ?? modal).focus();
    return () => {
      app?.removeAttribute('inert');
      opener?.focus();
    };
  }, [ref]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modal = ref.current;
      if (!modal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusables(modal);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const inside = modal.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(ref, onClose);
  return createPortal(
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
