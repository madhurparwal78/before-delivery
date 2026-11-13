import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushLayer } from './layers';
import { prefersReducedMotion, tabbables } from './hooks';

interface DialogProps {
  name: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Sheets that leave the stage visible have no scrim. */
  scrim?: boolean;
  /** Where focus lands first; the first control otherwise. */
  initialFocus?: (root: HTMLElement) => HTMLElement | null | undefined;
  /** Where focus goes on close; the control that had focus on open otherwise. */
  returnFocus?: () => HTMLElement | null | undefined;
}

/**
 * A modal dialog or sheet: focus moves in on open, Tab and Shift+Tab wrap, Escape and the close control close it
 * and give focus back, and a control that disappears hands focus to the sheet's first control.
 */
export function Dialog({ name, open, onClose, children, className = '', scrim = true, initialFocus, returnFocus }: DialogProps) {
  const [phase, setPhase] = useState<'unused' | 'closing' | 'closed'>('unused');
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dialog = root.current!;
    const first = initialFocus?.(dialog) ?? tabbables(dialog)[0] ?? dialog;
    first.focus({ preventScroll: true });
    const pop = pushLayer({ close: () => closeRef.current(), name });
    const observer = new MutationObserver(() => {
      if (!dialog.contains(document.activeElement)) (tabbables(dialog)[0] ?? dialog).focus({ preventScroll: true });
    });
    observer.observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    return () => {
      pop();
      observer.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (open || !wasOpen.current) return;
    wasOpen.current = false;
    const target = returnFocus?.() ?? opener.current;
    target?.focus({ preventScroll: true });
    setPhase(prefersReducedMotion() ? 'closed' : 'closing');
  }, [open]);

  useEffect(() => {
    if (phase !== 'closing') return;
    const fallback = window.setTimeout(() => setPhase('closed'), 600);
    return () => window.clearTimeout(fallback);
  }, [phase]);

  if (!open && phase === 'unused') return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const list = tabbables(root.current!);
    if (list.length === 0) {
      event.preventDefault();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || !root.current!.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const state = open ? 'open' : phase === 'closing' ? 'closing' : 'closed';
  return createPortal(
    <div className={`layer ${scrim ? 'with-scrim' : 'no-scrim'}`} data-state={state}>
      {scrim ? <div className="scrim" data-state={state} aria-hidden="true" /> : null}
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        className={`dialog ${className}`}
        data-state={state}
        onKeyDown={onKeyDown}
        inert={!open && phase === 'closed'}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) setPhase('closed');
        }}
      >
        <div className="dialog-inner">{children}</div>
      </div>
    </div>,
    document.getElementById('layers')!,
  );
}
