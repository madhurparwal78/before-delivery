import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { pushEscapeHandler } from './escape';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => pushEscapeHandler(() => closeRef.current()), []);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
          if (nodes.length === 0) return;
          const first = nodes[0]!;
          const last = nodes[nodes.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ErrorSummary({ errors }: { errors: Record<string, string> }): ReactElement | null {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary">
      <h3>Check the highlighted fields.</h3>
      <ul>
        {entries.map(([field, copy]) => (
          <li key={field}>
            <a
              href={`#field-${field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`field-${field}`)?.focus();
              }}
            >
              {copy}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
