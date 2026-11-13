import {
  useEffect, useId, useLayoutEffect, useRef,
  type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref
} from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import type { Announcer } from './hooks.js';

type Tone = 'navy' | 'cobalt' | 'ghost' | 'danger';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  pending?: boolean;
  pendingText?: string;
}

/** A fully rounded action. While pending it shows the pending text and is disabled. */
export function Pill({ tone = 'navy', pending = false, pendingText = 'Working…', className = '', children, disabled, ...rest }: PillProps) {
  return (
    <button type="button" {...rest} className={`pill pill-${tone} ${className}`.trim()} disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending ? (
        <>
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  className?: string;
  children: (props: { id: string; 'aria-invalid': true | undefined; 'aria-describedby': string | undefined }) => ReactNode;
}

/** A labelled control with its error attached to it. */
export function Field({ label, error, hint, className = '', children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described })}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error">
      <CircleAlert aria-hidden="true" size={16} />
      <span>{children}</span>
    </p>
  );
}

/** Focuses the first control (by `data-field`) whose field has an error, in the order the fields appear. */
export function focusFirstInvalid(root: ParentNode | null, order: readonly string[], errors: Record<string, string>): void {
  const field = order.find((name) => errors[name] !== undefined);
  if (field) root?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
}

/** A live region; saying the same text again replaces its node so it is announced again. */
export function Status({ label, announcer, className = '' }: { label: string; announcer: Announcer; className?: string }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {announcer.text && <span key={announcer.seq}>{announcer.text}</span>}
    </div>
  );
}

/** A violet-barred panel in the layout flow for refusals and outages. Never a toast. */
export function Panel({ children, panelRef, tabbable = false }: { children: ReactNode; panelRef?: Ref<HTMLDivElement>; tabbable?: boolean }) {
  return (
    <div role="alert" className="panel" ref={panelRef} tabIndex={tabbable ? -1 : undefined}>
      <CircleAlert aria-hidden="true" size={20} />
      <div>{children}</div>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);

interface DialogProps {
  title: string;
  onClose: () => void;
  variant?: 'dialog' | 'drawer';
  /** The control that gets focus back on close; defaults to the control focused when the dialog opened. */
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
}

/** A modal dialog: focus starts on its first control, Tab and Shift+Tab wrap, Escape closes, focus returns to the opener. */
export function Dialog({ title, onClose, variant = 'dialog', returnFocus, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    dialog.showModal();
    (focusables(dialog).find((element) => !element.hasAttribute('data-dialog-close')) ?? dialog).focus();
    return () => {
      dialog.close();
      (returnFocus?.() ?? opener.current)?.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    const cancel = (event: Event): void => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>): void => {
    const dialog = event.currentTarget;
    if (event.key === 'Escape') {
      event.preventDefault();
      close.current();
    } else if (event.key === 'Tab') {
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant}`}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id={headingId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

export function Skeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} style={{ width: `${92 - index * 14}%` }} />
      ))}
    </div>
  );
}

type Mark = 'wall' | 'event' | 'rings' | 'list';

/** A small drawn mark for an empty state. */
export function EmptyMark({ kind }: { kind: Mark }) {
  return (
    <svg className="empty-mark" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
      {kind === 'wall' && (
        <>
          <rect x="8" y="22" width="34" height="22" rx="6" className="mark-line" />
          <rect x="48" y="22" width="40" height="22" rx="6" className="mark-fill" />
          <rect x="18" y="52" width="40" height="22" rx="6" className="mark-fill" />
          <rect x="64" y="52" width="24" height="22" rx="6" className="mark-line" />
        </>
      )}
      {kind === 'event' && (
        <>
          <path d="M10 74h76" className="mark-road" />
          <circle cx="16" cy="74" r="6" className="mark-dot" />
          <path d="M72 74V28" className="mark-pole" />
          <path d="M72 28h16l-5 7 5 7H72z" className="mark-flag" />
        </>
      )}
      {kind === 'rings' && (
        <>
          <circle cx="48" cy="48" r="28" className="mark-track" />
          <path d="M48 20a28 28 0 0 1 24 14" className="mark-arc" />
        </>
      )}
      {kind === 'list' && (
        <>
          <rect x="14" y="18" width="68" height="14" rx="7" className="mark-fill" />
          <rect x="14" y="41" width="68" height="14" rx="7" className="mark-line" />
          <rect x="14" y="64" width="44" height="14" rx="7" className="mark-line" />
        </>
      )}
    </svg>
  );
}
