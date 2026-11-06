// Labelled form controls with inline errors ("Error: <copy>" + icon). No native validation attributes:
// forms are noValidate and the server's 422 copy is the only source of field errors.
// Every control takes an `id`; the Problems summary links to that id.

import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { Icon } from "./icons.js";

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="field-error">
      <Icon name="circle-alert" />
      <span>Error: {error}</span>
    </p>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return ids || undefined;
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ id, label, value, onChange, error, hint, type = "text", ref, ...rest }: TextFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
      <input ref={ref} id={id} className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} {...rest} />
      <FieldError id={id} error={error} />
    </div>
  );
}

export function TextArea({ id, label, value, onChange, error, hint, rows = 5 }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  rows?: number;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" rows={rows} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} />
      {hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
      <FieldError id={id} error={error} />
    </div>
  );
}

export interface Choice {
  value: string;
  label: string;
}

/** A radiogroup named by its label. The first radio carries `id`, so a Problems link can focus it. */
export function RadioGroup({ id, label, name, choices, value, onChange, error }: {
  id: string;
  label: string;
  name: string;
  choices: Choice[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="radio-group">
      <span id={`${id}-label`} className="group-label">{label}</span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-error` : undefined}
        className="radio-options">
        {choices.map((choice, i) => (
          <label key={choice.value} className="radio">
            <input type="radio" id={i === 0 ? id : `${id}-${choice.value}`} name={name} value={choice.value}
              checked={value === choice.value} onChange={() => onChange(choice.value)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}

export function Select({ id, label, choices, value, onChange, error }: {
  id: string;
  label: string;
  choices: Choice[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
      <FieldError id={id} error={error} />
    </div>
  );
}

export function Checkbox({ id, label, checked, onChange }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
