import type { ReactNode } from "react";
import { COLOUR_FAMILIES } from "../../shared/api";

interface SegmentedProps<T extends string> {
  label: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  firstId?: string;
}

export function Segmented<T extends string>({ label, name, value, options, onChange, firstId }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option, index) => (
        <label key={option.value} className="seg">
          <input
            type="radio"
            id={index === 0 ? firstId : undefined}
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  multiline?: boolean;
  inputMode?: "numeric" | "decimal" | "url";
  hint?: string;
}

export function TextField({ id, label, value, onChange, error, multiline, inputMode, hint }: TextFieldProps) {
  const shared = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  } as const;
  return (
    <div className="field-row">
      <div className="label-line">
        <label htmlFor={id}>{label}</label>
        {hint && (
          <span className="unit-hint" aria-hidden="true">
            {hint}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea {...shared} rows={4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...shared} type="text" inputMode={inputMode} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      )}
      <FieldError id={id} error={error} />
    </div>
  );
}

export function FieldError({ id, error }: { id: string; error: string | undefined }): ReactNode {
  return error ? (
    <p id={`${id}-error`} className="field-error">
      {error}
    </p>
  ) : null;
}

interface ColourSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  allLabel?: string;
}

export function ColourSelect({ id, value, onChange, error, allLabel }: ColourSelectProps) {
  return (
    <div className="field-row">
      <div className="label-line">
        <label htmlFor={id}>Colour family</label>
      </div>
      <select
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel ?? "Choose a colour family"}</option>
        {COLOUR_FAMILIES.map((family) => (
          <option key={family} value={family}>
            {family}
          </option>
        ))}
      </select>
      <FieldError id={id} error={error} />
    </div>
  );
}
