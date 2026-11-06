import { useEffect, useRef, useState, type ReactNode } from 'react';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A sheet: slides in from the right (>=768px) or up from the bottom (375px).
 * Focus is trapped inside while open; Escape/Close/backdrop closes it and
 * returns focus to the opening control. Reopening while closing leaves it open.
 */
export interface SheetHandle {
  close(): void;
}

export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  anchorRef?: React.RefObject<HTMLElement | null>;
  id: string;
}): JSX.Element {
  const { open, onClose, title, children, anchorRef, id } = props;
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rendered, setRendered] = useState(open);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (open) {
      // Reopening while closing cancels the close timer.
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setExiting(false);
      setRendered(true);
      requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        const focusables = node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length) focusables[0]!.focus();
        else node.focus();
      });
      return;
    }
    if (!rendered) return;
    // Start closing. Once closing starts the sheet stops blocking the page.
    setExiting(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setRendered(false);
      setExiting(false);
      const anchor = anchorRef?.current;
      if (anchor && document.contains(anchor)) anchor.focus();
    }, reducedMotion() ? 0 : 320);
    return () => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    };
  }, [open]);

  useEffect(() => {
    if (!rendered || !open) return;
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!node.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [rendered, open]);

  if (!rendered) return <></>;
  return (
    <>
      <div className={`sheet-backdrop ${exiting ? 'sheet-backdrop-exit' : ''}`} onClick={() => { if (!exiting) onClose(); }} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        id={id}
        className={`sheet ${exiting ? 'sheet-exit' : ''}`}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
  