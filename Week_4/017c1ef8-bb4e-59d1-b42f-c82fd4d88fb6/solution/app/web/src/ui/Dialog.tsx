import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([type="hidden"]):not([type="file"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';
const INTERACTIVE = 'input, textarea, select, button, a, label, summary, [tabindex], [role="option"], [role="menuitem"]';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const tabbables = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => element.getClientRects().length > 0);

interface DialogProps {
  /** The dialog's accessible name. */
  name: string;
  open: boolean;
  /** Escape and Cancel call this; the parent flips `open`. */
  onClose: () => void;
  /** Where focus goes on close when it is not the control that opened the dialog. */
  returnFocus?: () => HTMLElement | null;
  /** Where focus goes on open when it is not the first field (or first button). */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null;
  className?: string;
  children: ReactNode;
}

/**
 * A modal dialog: focus moves in on open, Tab stays inside, Escape closes, focus returns to the control that
 * opened it. Fades in and out over the dialog motion token; reduced motion skips both fades.
 */
export function Dialog({ name, open, onClose, returnFocus, initialFocus, className, children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  const [closing, setClosing] = useState(false);

  if (wasOpen.current && !open && !closing && !reducedMotion()) setClosing(true);
  if (open && closing) setClosing(false);
  wasOpen.current = open;

  useLayoutEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement as HTMLElement | null;
    const first = (): HTMLElement | undefined =>
      panel.current ? (panel.current.querySelector<HTMLElement>(FIELD) ?? tabbables(panel.current)[0]) : undefined;
    const custom = panel.current ? initialFocus?.(panel.current) : null;
    (custom ?? first())?.focus();
    const keepFocusInside = (event: FocusEvent): void => {
      const target = event.target as Element | null;
      if (!panel.current || !target || panel.current.contains(target) || target.closest('[role="dialog"]')) return;
      first()?.focus();
    };
    document.addEventListener('focusin', keepFocusInside);
    return () => document.removeEventListener('focusin', keepFocusInside);
  }, [open]);

  // Focus goes back after React's own focus restoration at the end of the commit.
  useEffect(() => {
    if (!open) return undefined;
    return () => {
      const back = returnFocus?.() ?? opener.current;
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setClosing(false), 600);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (!open && !closing) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = tabbables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="dialog-scrim" data-state={closing ? 'closing' : 'open'} onAnimationEnd={() => closing && setClosing(false)}>
      <div
        ref={panel}
        role="dialog"
        aria-label={name}
        className={className ? `dialog ${className}` : 'dialog'}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (!(event.target as Element).closest(INTERACTIVE)) event.preventDefault();
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
