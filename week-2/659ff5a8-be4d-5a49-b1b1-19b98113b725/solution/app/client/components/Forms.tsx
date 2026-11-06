import { type ReactNode, useId } from "react";

export type FieldErrors = Record<string, string>;

/** Field ids are `<form id>-<field>` so the summary links can focus them. */
const fieldId = (form: string, field: string): string => `${form}-${field}`;

interface FixFieldsProps {
  form: string;
  errors: FieldErrors;
}

/** The `Fix these fields` alert: one link per invalid field, whose text is the field's error message. */
export function FixFields({ form, errors }: FixFieldsProps) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  const focusField = (field: string): void => {
    const target = document.getElementById(fieldId(form, field));
    const control = target?.matches("input, select, textarea, button") ? target : target?.querySelector<HTMLElement>("input, select, textarea, button");
    control?.focus();
  };
  return (
    <div role="alert" className="fix-fields">
      <h3 className="h4">Fix these fields</h3>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${fieldId(form, field)}`}
              onClick={(event) => {
                event.preventDefault();
                focusField(field);
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FieldProps {
  form: string;
  name: string;
  label: string;
  error: string | undefined;
  hint?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}

/** A labelled control with its error message directly beneath it. */
export function Field({ form, name, label, error, hint, children }: FieldProps) {
  const id = fieldId(form, name);
  const errorId = `${id}-error`;
  const hintId = useId();
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error !== undefined, "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          <span className="error-mark" aria-hidden="true">
            Error:
          </span>{" "}
          {error}
        </p>
      ) : null}
    </div>
  );
}
