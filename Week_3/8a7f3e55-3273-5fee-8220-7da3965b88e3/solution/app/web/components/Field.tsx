import type { ReactNode } from "react";

interface FieldProps {
  id: string;
  label: string;
  /** Hint text, set in monospace; becomes part of the control's accessible description. */
  hint?: string;
  error?: string | undefined;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean }) => ReactNode;
}

/** A labelled control with an optional hint and a message under it; the control is described by both. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter((part): part is string => part !== null).join(" ");
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy === "" ? undefined : describedBy, "aria-invalid": Boolean(error) })}
      {hint ? (
        <p id={hintId} className="field-hint mono">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
