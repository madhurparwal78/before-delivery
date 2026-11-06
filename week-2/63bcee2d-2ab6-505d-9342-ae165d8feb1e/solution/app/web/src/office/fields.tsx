import { useId, type InputHTMLAttributes, type ReactNode } from "react";

// Labelled fields whose error text sits under the field and is summarised at the top of the form as links.
// Validation is the server's: forms accept any typed value and show the API's field error copy after submit.

export type Errors = Record<string, string>;

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** The API field name; used for the field's id so the summary can link to it. */
  name: string;
  form: string;
  multiline?: boolean;
  type?: "text" | "email" | "password" | "date" | "datetime-local" | "month" | "number" | "search";
  hint?: ReactNode;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  step?: string;
}

export const fieldId = (form: string, name: string): string => `${form}-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export function TextField({ label, value, onChange, error, name, form, multiline, type = "text", hint, inputMode, autoComplete, step }: TextFieldProps) {
  const id = fieldId(form, name);
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name, value, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, className: "input" };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {multiline ? (
        <textarea {...common} onChange={(event) => onChange(event.target.value)} rows={4} />
      ) : (
        <input {...common} type={type} inputMode={inputMode} autoComplete={autoComplete} step={step}
          onChange={(event) => onChange(event.target.value)} />
      )}
      {error && <span className="field-error" id={`${id}-error`} tabIndex={-1}>{error}</span>}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  name: string;
  form: string;
  placeholder?: string;
}

export function SelectField({ label, value, onChange, options, error, name, form, placeholder }: SelectFieldProps) {
  const id = fieldId(form, name);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className="input" value={value} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error && <span className="field-error" id={`${id}-error`} tabIndex={-1}>{error}</span>}
    </div>
  );
}

/** The error summary: one link per refused field that moves focus to it. */
export function ErrorSummary({ errors, form }: { errors: Errors; form: string }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div className="error-summary">
      <h3>There is a problem</h3>
      <ul>
        {entries.map(([name, copy]) => (
          <li key={name}>
            <a href={`#${fieldId(form, name)}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(fieldId(form, name))?.focus();
            }}>{copy}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A unique form id for field ids within the page. */
export const useFormId = (prefix: string): string => `${prefix}${useId().replace(/:/g, "")}`;

/**
 * Whole cents from a typed amount such as `1250.00`, `1,250` or `-12.5`; what was typed when it isn't an
 * amount, so the server answers with its amount-format copy.
 */
export function amountInput(typed: string): number | string {
  const text = typed.trim().replace(/,/g, "");
  const found = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!found) return typed;
  const cents = Number(found[2]) * 100 + Number((found[3] ?? "").padEnd(2, "0") || "0");
  return found[1] ? -cents : cents;
}
