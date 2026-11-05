import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

export interface DialogProps {
  readonly name: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly restoreFocusTo?: () => HTMLElement | null;
}

/** A modal dialog that traps Tab, closes on Escape and restores focus. */
export function Dialog({ name, onClose, children, restoreFocusTo }: DialogProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restore = useRef(restoreFocusTo);
  restore.current = restoreFocusTo;

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = ref.current === null ? null : focusableIn(ref.current)[0];
    first?.focus();
    return () => {
      const target = restore.current?.() ?? opener.current;
      target?.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || ref.current === null) return;
      const items = focusableIn(ref.current);
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
    },
    [onClose],
  );

  return (
    <div className="scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export interface LiveRegionProps {
  readonly name: string;
  readonly message: string;
}

export function LiveRegion({ name, message }: LiveRegionProps): ReactNode {
  return (
    <p role="status" aria-live="polite" aria-label={name} className="live">
      {message}
    </p>
  );
}

export interface DisclosureProps {
  readonly buttonLabel: string;
  readonly buttonText: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A closed panel renders nothing: it is invisible, unfocusable and unexposed. */
export function Disclosure({
  buttonLabel,
  buttonText,
  children,
  className,
}: DisclosureProps): ReactNode {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="disclosure-button"
      >
        {buttonText}
      </button>
      {open ? (
        <div id={panelId} className="disclosure-panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly error?: string;
  readonly fieldId?: string;
  readonly inputRef?: React.Ref<HTMLInputElement>;
}

export function Field({
  label,
  value,
  onChange,
  type,
  error,
  fieldId,
  inputRef,
}: FieldProps): ReactNode {
  const generated = useId();
  const id = fieldId ?? generated;
  const errorId = `${id}-error`;
  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type={type ?? 'text'}
        value={value}
        aria-label={label}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === undefined ? null : (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </p>
  );
}

const COUNT_MS = 600;

/** A numeral that counts from its old value to its new one, unless motion is reduced. */
export function CountingNumber({
  value,
  reduced,
}: {
  readonly value: number;
  readonly reduced: boolean;
}): ReactNode {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const startedAt = performance.now();
    let frame = 0;
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - startedAt) / COUNT_MS);
      setShown(Math.round(start + (value - start) * progress));
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduced, value]);

  return <span className="num">{shown}</span>;
}

export interface ErrorSummaryProps {
  readonly errors: Record<string, string>;
  readonly fieldIds: Record<string, string>;
}

/** A summary at the top of a form that links to each field that needs attention. */
export function ErrorSummary({ errors, fieldIds }: ErrorSummaryProps): ReactNode {
  const entries = Object.entries(errors).filter(([field]) => fieldIds[field] !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary" role="alert">
      <p>Some fields need attention.</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#${fieldIds[field] as string}`}>{message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
