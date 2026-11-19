import { useId } from 'react';
import type { HTMLInputTypeAttribute, ReactNode } from 'react';

interface FieldFrameProps {
  label: string;
  error?: string | null;
  hint?: string;
  inputId: string;
  errorId: string;
  children: ReactNode;
}

function FieldFrame({ label, error, hint, inputId, errorId, children }: FieldFrameProps) {
  return (
    <div className="field">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  error?: string | null;
  hint?: string;
  autoComplete?: string;
  disabled?: boolean;
}

/** A labelled input: the label is the accessible name. `type="number"` gives a spinbutton. */
export function TextField({ label, value, onChange, type = 'text', error, hint, autoComplete, disabled }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldFrame label={label} error={error} hint={hint} inputId={id} errorId={errorId}>
      <input
        id={id}
        className="control"
        type={type}
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

interface Option {
  value: string;
  label: string;
}

export function options(values: readonly string[]): Option[] {
  return values.map((value) => ({ value, label: value }));
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  error?: string | null;
  disabled?: boolean;
}

/** A native select, so keyboards, touch pickers and the test driver all work. */
export function Select({ label, value, onChange, options: choices, error, disabled }: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldFrame label={label} error={error} inputId={id} errorId={errorId}>
      <select
        id={id}
        className="control control-select"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** The whole row is the tap target; the label is the accessible name. */
export function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
