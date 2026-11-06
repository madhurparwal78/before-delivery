import { useEffect, useRef, type ReactNode } from 'react';
import { ui } from '../../shared/copy.js';
import { departmentName } from '../../shared/domain.js';
import { setState } from '../store.js';

export function Num({ children }: { children: ReactNode }): JSX.Element {
  return <span className="num">{children}</span>;
}

export function Tape({ department }: { department: string | null }): JSX.Element | null {
  if (department === null) return null;
  return <span className={`tape tape-${department}`}>{departmentName(department)}</span>;
}

export function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'status' | 'blocked';
}): JSX.Element {
  return <span className={`chip chip-${tone}`}>{label}</span>;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(holder: HTMLElement): HTMLElement[] {
  return [...holder.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/** Dialogs and the phone sheet keep Tab inside them and return focus to their opener. */
export function Dialog({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const holder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = holder.current === null ? null : focusables(holder.current)[0];
    (first ?? holder.current)?.focus();
    return () => {
      const target = opener.current;
      if (target !== null && target.isConnected) target.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || holder.current === null) return;
    const items = focusables(holder.current);
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

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={`dialog ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={holder}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function closeDialog(): void {
  setState({ dialog: { kind: 'none' }, formErrors: {} });
}

export function ErrorSummary({
  errors,
  fieldIds,
}: {
  errors: Record<string, string>;
  fieldIds: Record<string, string>;
}): JSX.Element | null {
  const holder = useRef<HTMLDivElement>(null);
  const keys = Object.keys(errors);
  useEffect(() => {
    if (keys.length > 0) holder.current?.focus();
  }, [keys.length, errors]);
  if (keys.length === 0) return null;
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={holder}>
      <h3>{ui.errorSummaryHeading}</h3>
      <ul>
        {keys.map((key) => (
          <li key={key}>
            <a
              href={`#${fieldIds[key] ?? ''}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(fieldIds[key] ?? '')?.focus();
              }}
            >
              {errors[key]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldError({ message }: { message: string | undefined }): JSX.Element | null {
  if (message === undefined) return null;
  return <p className="field-error">{message}</p>;
}
