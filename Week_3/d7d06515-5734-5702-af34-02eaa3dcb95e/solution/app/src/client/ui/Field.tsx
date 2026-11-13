// Labelled text input whose error is tied to the field with aria-describedby (brief: Account > alert).
import { useId } from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** `secret` masks like a password but keeps the textbox role the product publishes. */
  kind?: 'text' | 'email' | 'secret';
  autoComplete?: string;
}

export function TextField({ label, value, onChange, error, kind = 'text', autoComplete }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type={kind === 'secret' ? 'password' : kind === 'email' ? 'email' : 'text'}
        role={kind === 'secret' ? 'textbox' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? <p id={errorId} className="field-error">{error}</p> : null}
    </div>
  );
}
