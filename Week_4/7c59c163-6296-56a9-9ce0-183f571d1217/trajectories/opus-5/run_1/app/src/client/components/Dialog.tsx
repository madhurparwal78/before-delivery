import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  label: string;
  onClose: () => void;
  /** Focus moves to this control when the dialog opens. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Where focus goes when the dialog closes; the opening control by default. */
  returnFocus?: () => HTMLElement | null;
  variant?: 'dialog' | 'sheet';
  children: React.ReactNode;
}

/**
 * Focus moves inside on open, wraps with Tab and Shift+Tab, Escape closes, and focus returns to the
 * control that opened it.
 */
export function Dialog(props: DialogProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnFocus = useRef(props.returnFocus);
  returnFocus.current = props.returnFocus;

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      props.initialFocus?.current ?? (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel);
    target?.focus();
    return () => (returnFocus.current?.() ?? openerRef.current)?.focus();
  }, [props.initialFocus]);

  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  /** Escape closes even when a control that had focus has just been disabled or removed. */
  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose.current();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (panel === null) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const sheet = props.variant === 'sheet';
  return (
    <div
      className={sheet ? 'scrim scrim--sheet' : 'scrim'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={panelRef}
        className={sheet ? 'dialog sheet' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  );
}
