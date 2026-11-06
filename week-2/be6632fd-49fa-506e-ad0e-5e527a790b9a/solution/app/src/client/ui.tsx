// Shared interface pieces: status regions, the Problems summary, fields, dialogs and status marks.
import { Moon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { COPY } from "../shared/copy";
import { type Refusal } from "./api";
import { Link, useRouter } from "./router";

// ---- announcements ----

export interface Message {
  text: string;
  signIn?: boolean;
}

/** The copy a refusal announces; session refusals carry the "Sign in again" link. */
export function refusalMessage(r: Refusal): Message {
  if (r.code === "session_ended" || r.code === "access_removed" || r.code === "unauthenticated") return { text: r.message, signIn: true };
  return { text: r.message };
}

export function StatusRegion({ name, message }: { name: string; message: Message | null }): JSX.Element {
  const { path } = useRouter();
  return (
    <div role="status" aria-live="polite" aria-label={name} className="status-line">
      {message?.text}
      {message?.signIn ? (
        <>
          {" "}
          <Link to={`/sign-in?next=${encodeURIComponent(path)}`}>Sign in again</Link>
        </>
      ) : null}
    </div>
  );
}

export function useMessage(): [Message | null, (m: Message | string | null) => void] {
  const [message, setMessage] = useState<Message | null>(null);
  const set = useCallback((m: Message | string | null) => setMessage(typeof m === "string" ? { text: m } : m), []);
  return [message, set];
}

// ---- headings ----

export function PageTitle({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <h1 tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}

// ---- fields ----

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "email" | "password" | "number" | "search" | "tel";
  multiline?: boolean;
  rows?: number;
  autoComplete?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement>;
  onBlur?: () => void;
  className?: string;
}

export function Field({ id, label, value, onChange, error, hint, type = "text", multiline, rows = 4, autoComplete, inputMode, inputRef, onBlur, className }: FieldProps): JSX.Element {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onBlur,
  };
  return (
    <div className={`field${error ? " has-error" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {multiline ? (
        <textarea {...common} rows={rows} ref={inputRef as RefObject<HTMLTextAreaElement>} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          ref={inputRef as RefObject<HTMLInputElement>}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  error,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  error?: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={`field${error ? " has-error" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A whole number typed into a field, sent as a number when it reads as one. */
export function wholeOrText(value: string): number | string {
  return /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
}

// ---- the Problems summary (forms outside dialogs) ----

interface Problem {
  fieldId: string;
  label: string;
  message: string;
}

export function Problems({ problems, regionRef }: { problems: Problem[]; regionRef: RefObject<HTMLElement> }): JSX.Element | null {
  const headingId = useId();
  if (!problems.length) return null;
  return (
    <section className="problems" aria-labelledby={headingId} tabIndex={-1} ref={regionRef}>
      <h2 id={headingId}>Problems</h2>
      <ul>
        {problems.map((p) => (
          <li key={p.fieldId}>
            <a
              href={`#${p.fieldId}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(p.fieldId)?.focus();
              }}
            >
              {p.label}: {p.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Field errors keyed by API path, the Problems list in field order, and focus on the region after a refusal. */
export function useProblems(fieldsInOrder: Array<{ path: string; id: string; label: string }>): {
  errors: Record<string, string>;
  problems: Problem[];
  regionRef: RefObject<HTMLElement>;
  show: (fields: Record<string, string>) => void;
  clear: () => void;
} {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const regionRef = useRef<HTMLElement>(null);
  const [focusNext, setFocusNext] = useState(0);
  useLayoutEffect(() => {
    if (focusNext) regionRef.current?.focus();
  }, [focusNext]);
  const problems = fieldsInOrder.filter((f) => errors[f.path]).map((f) => ({ fieldId: f.id, label: f.label, message: errors[f.path] }));
  return {
    errors,
    problems,
    regionRef,
    show: (fields) => {
      setErrors(fields);
      setFocusNext((n) => n + 1);
    },
    clear: () => setErrors({}),
  };
}

// ---- buttons ----

export function Button({
  children,
  pending,
  pendingText,
  variant = "secondary",
  onClick,
  type = "button",
  disabled,
  form,
  buttonRef,
  className,
}: {
  children: ReactNode;
  pending?: boolean;
  pendingText?: string;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  form?: string;
  buttonRef?: RefObject<HTMLButtonElement>;
  className?: string;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type={type}
      form={form}
      className={`btn btn-${variant}${pending ? " is-pending" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled || pending}
      onClick={onClick}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

// ---- dialogs ----

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal `<dialog>`: focus moves to its first field (or first button), Tab stays inside, Escape closes. The
 * refusal alert at the top names the problems and takes focus.
 */
export function Dialog({
  title,
  onClose,
  children,
  alert,
  alertKey,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  alert?: string | null;
  alertKey?: number;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    const fields = dialog.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]');
    const first = fields[0] ?? dialog.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();
    const onCancel = (event: Event): void => {
      event.preventDefault();
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const all = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!all.length) return;
      const firstEl = all[0];
      const lastEl = all[all.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKey);
      if (dialog.open) dialog.close();
    };
  }, []);
  useLayoutEffect(() => {
    if (alert) alertRef.current?.focus();
  }, [alert, alertKey]);
  return (
    <dialog ref={ref} aria-labelledby={headingId} className={`dialog${className ? ` ${className}` : ""}`}>
      <div className="dialog-body">
        <h2 id={headingId}>{title}</h2>
        {alert ? (
          <div role="alert" tabIndex={-1} ref={alertRef} className="dialog-alert">
            {alert}
          </div>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}

/** Focus after a dialog closes: its opener by default, or the published target. */
export function focusLater(target: () => HTMLElement | null | undefined): void {
  window.setTimeout(() => target()?.focus(), 0);
}

// ---- tables ----

export function EmptyRow({ columns }: { columns: number }): JSX.Element {
  return (
    <tr className="empty-row">
      <td colSpan={columns}>{COPY.empty}</td>
    </tr>
  );
}

// ---- status marks ----

export type StatusWord = "upcoming" | "live" | "sold_out" | "withdrawn" | "draft" | "scheduled";

const WORD: Record<StatusWord, string> = {
  upcoming: "Upcoming",
  live: "Live",
  sold_out: "Sold out",
  withdrawn: "Withdrawn",
  draft: "Draft",
  scheduled: "Scheduled",
};

/** Upcoming a hollow ring; Live a filled dot inside a ring; Sold out a ring with a slash; Withdrawn a cross. */
export function StatusMark({ status }: { status: StatusWord }): JSX.Element {
  const shape =
    status === "live" ? (
      <>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="3" fill="currentColor" />
      </>
    ) : status === "sold_out" ? (
      <>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke="currentColor" strokeWidth="1.5" />
      </>
    ) : status === "withdrawn" ? (
      <>
        <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.75" />
        <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1.75" />
      </>
    ) : status === "draft" ? (
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
    ) : (
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    );
  return (
    <span className={`status-mark status-${status}`}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        {shape}
      </svg>
      <span>{WORD[status]}</span>
    </span>
  );
}

export function NightMark(): JSX.Element {
  return (
    <span className="night-mark">
      <Moon size={13} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      Night
    </span>
  );
}

export function Loading(): JSX.Element {
  return <p className="loading">Loading…</p>;
}
