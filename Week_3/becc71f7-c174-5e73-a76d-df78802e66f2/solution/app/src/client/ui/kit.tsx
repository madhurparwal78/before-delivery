// The shared controls: links, buttons, form fields, the Problems summary and the table frame.
import { useEffect, useRef, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import type { Option } from "../../shared/catalog";
import type { Action, Fields } from "../hooks";
import { navigate, takeHeadingFocus } from "../state";

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; "aria-current"?: "page" | undefined; onClick?: () => void }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    rest.onClick?.();
    navigate(to);
  };
  return (
    <a href={to} className={className} aria-current={rest["aria-current"]} onClick={follow}>
      {children}
    </a>
  );
}

export function Heading({ children, className }: { children: ReactNode; className?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeHeadingFocus()) heading.current?.focus();
  }, []);
  return (
    <h1 ref={heading} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}

export function Button({ action, children, kind = "secondary", ref, ...rest }: { action?: Action; children: ReactNode; kind?: "primary" | "secondary"; ref?: Ref<HTMLButtonElement>; type?: "button" | "submit"; disabled?: boolean; onClick?: () => void }) {
  const pending = action?.pending ?? false;
  return (
    <button ref={ref} type={rest.type ?? "button"} className={`button ${kind}`} disabled={pending || rest.disabled} onClick={rest.onClick}>
      {pending ? "Working…" : children}
    </button>
  );
}

const fieldId = (name: string): string => `field-${name}`;

export function Problems({ action }: { action: Action }) {
  const { problem, summary } = action;
  if (!problem) return null;
  const entries = Object.entries(problem.fields);
  return (
    <div className="problems" role="region" aria-label="Problems" tabIndex={-1} ref={summary}>
      <h2 className="problems-title">There&apos;s a problem</h2>
      {entries.length === 0 ? (
        <p>{problem.message}</p>
      ) : (
        <ul>
          {entries.map(([field, message]) => (
            <li key={field}>
              <a
                href={`#${fieldId(field)}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(fieldId(field))?.focus();
                }}
              >
                {message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FieldProps<K extends string> {
  form: Fields<K>;
  action: Action;
  name: K;
  /** The server's name for this field, when it differs. */
  problemKey?: string;
  label: string;
  hint?: string;
}

function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <div className={error ? "field invalid" : "field"}>
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string): string | undefined => [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

export function TextField<K extends string>({ form, action, name, problemKey, label, hint, type = "text", inputMode, autoComplete }: FieldProps<K> & { type?: "text" | "email" | "password" | "tel"; inputMode?: "numeric" | "decimal"; autoComplete?: string }) {
  const key = problemKey ?? name;
  const id = fieldId(key);
  const error = action.problem?.fields[key];
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete ?? "off"}
        value={form.values[name]}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => form.set(name, event.target.value)}
      />
    </FieldShell>
  );
}

export function SelectField<K extends string>({ form, action, name, problemKey, label, hint, options, placeholder }: FieldProps<K> & { options: readonly Option[]; placeholder?: string }) {
  const key = problemKey ?? name;
  const id = fieldId(key);
  const error = action.problem?.fields[key];
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="select-box">
        <select id={id} name={name} value={form.values[name]} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} onChange={(event) => form.set(name, event.target.value)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={18} />
      </div>
    </FieldShell>
  );
}

export function RadioGroup({ label, name, options, value, onChange, grid = false, error, adorn }: { label: string; name: string; options: readonly Option[]; value: string; onChange: (value: string) => void; grid?: boolean; error?: string | undefined; adorn?: (option: Option) => ReactNode }) {
  const id = fieldId(name);
  return (
    <div className={grid ? "radio-group grid" : "radio-group"} role="radiogroup" aria-label={label}>
      <p className="radio-title" aria-hidden="true">
        {label}
      </p>
      <div className="radio-options">
        {options.map((option, index) => (
          <label key={option.value} className="radio">
            <input type="radio" id={index === 0 ? id : undefined} name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {adorn?.(option)}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** A form inside a dialog: the Problems summary and fields scroll, the buttons stay in view. */
export function DialogForm({ action, submit, onSubmit, onCancel, cancel = "Cancel", children }: { action: Action; submit: string; onSubmit: () => Promise<void>; onCancel: () => void; cancel?: string; children: ReactNode }) {
  const send = (event: FormEvent): void => {
    event.preventDefault();
    if (!action.pending) void action.run(onSubmit);
  };
  return (
    <form className="dialog-form" onSubmit={send} noValidate>
      <div className="dialog-body">
        <Problems action={action} />
        {children}
      </div>
      <div className="dialog-foot">
        <Button action={action} kind="primary" type="submit">
          {submit}
        </Button>
        <Button onClick={onCancel}>{cancel}</Button>
      </div>
    </form>
  );
}

export function TableFrame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="table-frame" role="region" aria-label={`${name} table`} tabIndex={0}>
      <table aria-label={name}>{children}</table>
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function NotFound() {
  return (
    <main className="center-column">
      <Heading>We couldn&apos;t find that page.</Heading>
      <p className="muted">
        The address may be out of date. <Link to="/">Back to the rail</Link>
      </p>
    </main>
  );
}

export function GoneScreen({ heading }: { heading: string }) {
  return (
    <main className="center-column">
      <Heading>{heading}</Heading>
      <p className="muted">
        <Link to="/">See what is on the rail</Link>
      </p>
    </main>
  );
}

/** An email address that may wrap only after its @. */
export function Email({ address }: { address: string | null }) {
  if (!address) return null;
  const [local, domain] = address.split("@");
  return (
    <span className="email">
      <span>{local}@</span>
      <wbr />
      <span>{domain}</span>
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}
