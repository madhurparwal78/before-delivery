import { useEffect, useRef, type ReactNode } from 'react';
import type { JSX } from 'react';

interface DialogProps {
  label: string;
  closeLabel: string;
  openerRef: React.MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab cycle only inside the dialog; Escape closes it and returns focus. */
export function Dialog(props: DialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const opener = props.openerRef.current;
    return () => {
      opener?.focus();
    };
  }, [props.openerRef]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (panel === null) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-scrim">
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-head">
          <h2 tabIndex={-1} ref={headingRef}>
            {props.label}
          </h2>
          <button type="button" onClick={props.onClose}>
            {props.closeLabel}
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
