import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
  /** Visually hidden label (the field is named but its words are elsewhere). */
  hideLabel?: boolean;
  numeric?: boolean;
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled input; a problem is shown under it in the conflict colour and wired up with aria-invalid. */
export function Field({ label, error, hideLabel, numeric, trailing, inputRef, className, ...input }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <div className="field-row">
        <input
          {...input}
          ref={inputRef}
          id={id}
          className={`${numeric ? 'num ' : ''}${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {trailing}
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface RadioOption<T extends string> {
  value: T;
  label: string;
}

/** A radio group drawn as a segmented control; the radio inputs themselves receive the click. */
export function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option) => (
        <label key={option.value} className={value === option.value ? 'on' : undefined}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
