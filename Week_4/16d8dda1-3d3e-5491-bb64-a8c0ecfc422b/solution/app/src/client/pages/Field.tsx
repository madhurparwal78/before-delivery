import { useId, type HTMLInputTypeAttribute } from 'react';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
}

/** A labelled text input; password inputs carry an explicit textbox role so they are found by name. */
export function Field({ label, value, onChange, type = 'text', autoComplete, placeholder, hint, autoFocus }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        role={type === 'password' ? 'textbox' : undefined}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
