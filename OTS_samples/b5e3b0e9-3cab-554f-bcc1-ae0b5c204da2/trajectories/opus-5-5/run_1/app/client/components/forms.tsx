import type { ComponentChildren, InputHTMLAttributes } from 'preact';

export function FormStatus({ text }: { text: string }) {
  return (
    <p role="status" aria-label="Form status" class="form-status">
      {text}
    </p>
  );
}

export interface FieldRef {
  id: string;
  label: string;
}

export function FormErrors({ errors, fields }: { errors: Record<string, string>; fields: Record<string, FieldRef> }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div role="alert" aria-label="Form errors" class="hatched-cell">
      <p class="cell-state">Check these fields</p>
      <ul>
        {entries.map(([name, message]) => {
          const field = fields[name];
          return (
            <li key={name}>
              {field ? (
                <a
                  href={`#${field.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(field.id)?.focus();
                  }}
                >
                  {field.label}: {message}
                </a>
              ) : (
                message
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ErrorCell({ label, text, children }: { label: string; text: string; children?: ComponentChildren }) {
  return (
    <div role="alert" aria-label={label} class={text ? 'hatched-cell' : 'live-empty'}>
      {text}
      {text ? children : null}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'label'> & {
  id: string;
  label: string;
  error?: string | undefined;
};

export function Field({ id, label, error, ...rest }: InputProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} class="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
