import { type ReactNode, type RefObject, useEffect, useId } from "react";
import { announce, PRIORITY } from "../announce";

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} tabIndex={-1} data-error className="banner field-error">{children}</p>;
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "email" | "password" | "number";
  hint?: string;
  multiline?: boolean;
  autoComplete?: string;
  inputMode?: "numeric" | "decimal" | "text";
}

export function TextField({ label, value, onChange, error, type = "text", hint, multiline, autoComplete, inputMode }: TextFieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const shared = {
    id, value, "aria-invalid": error ? true : undefined, "aria-describedby": described, autoComplete, spellCheck: false,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
      {multiline ? <textarea rows={5} {...shared} /> : <input type={type} inputMode={inputMode} {...shared} />}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function SelectField({ label, value, onChange, error, placeholder, options }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; placeholder?: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function RadioGroup({ label, value, onChange, error, options }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={`${id}-label`} className="label">{label}</span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-error` : undefined} className="radios">
        {options.map((o) => (
          <label key={o.value} className="radio">
            <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * After a refused submit, announces the first field message in form order; dialogs also move focus to the first
 * message or notice (a conflict, a refused extension) so the keyboard lands on what went wrong.
 */
export function useFirstMessage(container: RefObject<HTMLElement | null>, failure: unknown, moveFocus: boolean): void {
  useEffect(() => {
    if (!failure) return;
    const first = container.current?.querySelector<HTMLElement>("[data-error], [data-notice]");
    if (!first) return;
    if (first.hasAttribute("data-error")) announce(first.textContent ?? "", PRIORITY.fieldError);
    if (moveFocus) first.focus();
  }, [failure, container, moveFocus]);
}
