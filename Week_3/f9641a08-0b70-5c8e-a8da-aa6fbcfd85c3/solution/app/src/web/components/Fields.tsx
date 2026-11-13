import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/** The id a field with this API key carries, so error summaries can link to it. */
export function fieldId(key: string): string {
  return `f-${key.replace(/[^a-z0-9]+/gi, "-")}`;
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "onChange" | "value"> {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
}

/** A labelled field; its error sits under it and is linked with aria-describedby. */
export function TextField({ name, label, value, onChange, error, hint, ...rest }: TextFieldProps) {
  const id = fieldId(name);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      <input
        {...rest}
        id={id}
        name={name}
        value={value}
        aria-describedby={described || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface AreaProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  rows?: number;
  maxLength?: number;
}

export function TextArea({ name, label, value, onChange, error, rows = 4, maxLength }: AreaProps) {
  const id = fieldId(name);
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface ChoiceProps {
  name: string;
  label: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

/** One native radio inside a 44px label. */
export function Choice({ name, label, value, checked, disabled, onChange }: ChoiceProps) {
  return (
    <label className="choice">
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

interface GroupProps {
  label: string;
  error?: string | undefined;
  name: string;
  children: ReactNode;
}

/** A labelled radio group; native radios give the arrow-key behaviour. */
export function RadioGroup({ label, error, name, children }: GroupProps) {
  const id = useId();
  const errorId = `${fieldId(name)}-error`;
  return (
    <div className="field" id={fieldId(name)} tabIndex={-1}>
      <span className="label" id={id}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} aria-describedby={error ? errorId : undefined} className="choice-list">
        {children}
      </div>
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface SummaryProps {
  errors: Record<string, string>;
  order: string[];
}

/** The `There is a problem` summary: one link per invalid field, in form order. */
export function ErrorSummary({ errors, order }: SummaryProps) {
  const keys = sortKeys(errors, order);
  if (keys.length === 0) return null;
  return (
    <div role="alert" className="error-summary">
      <h2>There is a problem</h2>
      <ul>
        {keys.map((key) => (
          <li key={key}>
            <a
              href={`#${fieldId(key)}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(fieldId(key))?.focus();
              }}
            >
              {errors[key]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function sortKeys(errors: Record<string, string>, order: string[]): string[] {
  const keys = Object.keys(errors);
  return [...keys.filter((k) => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b)), ...keys.filter((k) => !order.includes(k))];
}

export function focusField(key: string): void {
  const element = document.getElementById(fieldId(key));
  if (!element) return;
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    return;
  }
  const control = element.querySelector<HTMLElement>('input:checked, input, [tabindex]');
  (control ?? element).focus();
}
