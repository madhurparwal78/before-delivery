// Labelled fields, the "There is a problem" summary and the busy button.

import {
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type Dispatch,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type SetStateAction,
} from "react";
import { useReducedMotion } from "../hooks.js";

export interface FieldError {
  /** The id of the field the message belongs to. */
  target: string;
  message: string;
}

export function ErrorSummary({ errors }: { errors: FieldError[] }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const shown = useRef<FieldError[]>([]);
  useEffect(() => {
    // Focus moves only for a fresh answer; a message cleared by editing its field leaves focus in that field.
    if (errors.some((error) => !shown.current.includes(error))) box.current?.focus();
    shown.current = errors;
  }, [errors]);
  if (errors.length === 0) return null;
  return (
    <div className="error-summary" ref={box} tabIndex={-1} aria-labelledby={titleId}>
      <h3 id={titleId}>There is a problem</h3>
      <ul>
        {errors.map((error) => (
          <li key={`${error.target}:${error.message}`}>
            <a
              href={`#${error.target}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.target)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children(describedBy)}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & { id: string; label: ReactNode; hint?: ReactNode; error?: string };

export function TextField({ id, label, hint, error, ...input }: InputProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {(describedBy) => <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />}
    </FieldShell>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & { id: string; label: ReactNode; hint?: ReactNode; error?: string };

export function SelectField({ id, label, hint, error, children, ...select }: SelectProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {(describedBy) => (
        <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...select}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}

type ButtonProps = ComponentProps<"button"> & { busy?: boolean; variant?: "primary" | "outline" | "quiet" };

/** While busy: disabled, aria-busy and three pulsing dots (the word "Working…" under reduced motion). */
export function Button({ busy = false, variant = "outline", className, children, disabled, ...rest }: ButtonProps) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      className={`button button-${variant}${className ? ` ${className}` : ""}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <span className="button-label">{children}</span>
      {busy ? (
        reduced ? (
          <span className="button-working" aria-hidden="true">
            Working…
          </span>
        ) : (
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )
      ) : null}
    </button>
  );
}

/** Maps server `fields` keys onto field ids; unknown keys go to `fallback`. */
export function fieldErrors(fields: Record<string, string> | undefined, ids: Record<string, string>, fallback: string): FieldError[] {
  return Object.entries(fields ?? {}).map(([key, message]) => ({ target: ids[key] ?? fallback, message }));
}

/** A form's input handler that drops the message of the field being edited; the next submit validates again. */
export function clearEdited(setErrors: Dispatch<SetStateAction<FieldError[]>>) {
  return (event: FormEvent<HTMLFormElement>) => {
    const id = (event.target as HTMLElement).id;
    setErrors((list) => (list.some((error) => error.target === id) ? list.filter((error) => error.target !== id) : list));
  };
}

export function errorFor(errors: FieldError[], id: string): string | undefined {
  return errors.find((error) => error.target === id)?.message;
}
