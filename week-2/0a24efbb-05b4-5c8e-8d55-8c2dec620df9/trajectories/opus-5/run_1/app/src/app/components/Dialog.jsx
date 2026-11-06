import { useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that keeps focus inside itself while open, closes on Escape and hands focus
 * back to the control that opened it.
 */
export function Dialog({ title, onClose, children, className }) {
  const panel = useRef(null);
  const opener = useRef(null);
  const headingId = useId();

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelectorAll(FOCUSABLE)[0];
    if (first) first.focus();
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...panel.current.querySelectorAll(FOCUSABLE)];
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

  return (
    <div className="dialog-layer">
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <h2 id={headingId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
