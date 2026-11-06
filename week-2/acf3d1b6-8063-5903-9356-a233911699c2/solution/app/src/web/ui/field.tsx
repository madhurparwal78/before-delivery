import { ChevronDown } from './icons.js';

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
}

const described = (id: string, error?: string) =>
  error ? { 'aria-describedby': `${id}-error`, 'aria-invalid': 'true' as const } : {};

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} class="field-error">
      {error}
    </p>
  ) : null;
}

const labelText = (label: string, required?: boolean) => (required ? `${label} *` : label);

interface InputProps extends FieldProps {
  type?: 'text' | 'email' | 'password';
  value: string;
  onInput?: (event: Event) => void;
  autocomplete?: string;
  readOnly?: boolean;
  'aria-describedby'?: string;
}

export function TextField({ id, label, required, error, type = 'text', ...input }: InputProps) {
  return (
    <div class={`field${error ? ' has-error' : ''}`}>
      <label for={id}>{labelText(label, required)}</label>
      {/* Preact types each input `type` separately; these three share every attribute used here. */}
      <input id={id} class="input" type={type as 'text'} {...input} {...described(id, error)} />
      <FieldError id={id} error={error} />
    </div>
  );
}

interface TextAreaProps extends FieldProps {
  value: string;
  onInput: (event: Event) => void;
  rows?: number;
}

export function TextArea({ id, label, required, error, ...input }: TextAreaProps) {
  return (
    <div class={`field${error ? ' has-error' : ''}`}>
      <label for={id}>{labelText(label, required)}</label>
      <textarea id={id} class="input textarea" {...input} {...described(id, error)} />
      <FieldError id={id} error={error} />
    </div>
  );
}

interface SelectProps extends FieldProps {
  options: { value: string; label: string }[];
  prompt?: string;
  value: string;
  onChange: (event: Event) => void;
}

export function SelectField({ id, label, required, error, options, prompt, ...select }: SelectProps) {
  return (
    <div class={`field${error ? ' has-error' : ''}`}>
      <label for={id}>{labelText(label, required)}</label>
      <div class="select-wrap">
        <select id={id} class="input select" {...select} {...described(id, error)}>
          {prompt !== undefined && <option value="">{prompt}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown class="select-chevron" />
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}

/** The alert that announces a refused form; the field messages sit under each field. */
export function ErrorSummary({ count }: { count: number }) {
  return (
    <p class="form-alert" role="alert">
      {count ? `Check the ${count === 1 ? 'highlighted field' : `${count} highlighted fields`}.` : ''}
    </p>
  );
}
