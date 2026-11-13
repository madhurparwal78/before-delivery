import type { ComponentChildren } from "preact";

// Labelled fields whose rejection copy sits under the field and is tied to it (brief: Interactions, Forms).

export type FieldErrors = Record<string, string>;

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (describedBy: string | undefined, invalid: boolean) => ComponentChildren;
}

export function Field({ id, label, error, hint, children }: FieldProps) {
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class={`field${error ? " field--invalid" : ""}`}>
      <label for={id} class="field__label">{label}</label>
      {hint ? <p id={`${id}-hint`} class="field__hint">{hint}</p> : null}
      {children(described, Boolean(error))}
      {error ? <p id={`${id}-error`} class="field__error">{error}</p> : null}
    </div>
  );
}

interface TextProps {
  id: string;
  label: string;
  value: string;
  onValue: (value: string) => void;
  error?: string | undefined;
  type?: "text" | "email" | "password" | "url" | "date" | "number";
  multiline?: boolean;
  autoComplete?: string;
  hint?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
}

export function TextField({ id, label, value, onValue, error, type = "text", multiline, autoComplete, hint, readOnly, min, max }: TextProps) {
  return (
    <Field id={id} label={label} error={error} {...(hint ? { hint } : {})}>
      {(describedBy, invalid) => multiline
        ? <textarea id={id} class="input input--area" value={value} readOnly={readOnly} aria-describedby={describedBy}
          aria-invalid={invalid || undefined} onInput={(e) => onValue(e.currentTarget.value)} rows={6} />
        : <input id={id} class="input" type={type} value={value} readOnly={readOnly} autoComplete={autoComplete}
          aria-describedby={describedBy} aria-invalid={invalid || undefined} min={min} max={max}
          onInput={(e) => onValue(e.currentTarget.value)} />}
    </Field>
  );
}

interface SelectProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValue: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}

export function SelectField({ id, label, value, options, onValue, error, disabled }: SelectProps) {
  return (
    <Field id={id} label={label} error={error}>
      {(describedBy, invalid) => (
        <select id={id} class="input input--select" value={value} disabled={disabled} aria-describedby={describedBy}
          aria-invalid={invalid || undefined} onChange={(e) => onValue(e.currentTarget.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Moves focus to the first rejected field, in the form's order. */
export function focusFirstError(order: [field: string, inputId: string][], errors: FieldErrors): void {
  const first = order.find(([field]) => errors[field]);
  if (first) document.getElementById(first[1])?.focus();
}

/** Buttons that show their pending copy while a request runs. */
export function Submit({ busy, label, pending, kind = "primary", disabled }: {
  busy: boolean; label: string; pending: string; kind?: "primary" | "danger" | "quiet"; disabled?: boolean;
}) {
  return (
    <button type="submit" class={`button button--${kind}`} disabled={busy || disabled} aria-busy={busy || undefined}>
      {busy ? pending : label}
    </button>
  );
}
