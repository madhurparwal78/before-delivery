import type { ComponentChildren, JSX } from "preact";

export type FieldErrors = Record<string, string>;

interface FieldProps {
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autocomplete: string;
  value: string;
  error?: string;
  onInput: (value: string) => void;
}

export function Field({ name, label, type, autocomplete, value, error, onInput }: FieldProps): JSX.Element {
  return (
    <div class="field">
      <label for={`field-${name}`}>{label}</label>
      <input
        id={`field-${name}`}
        name={name}
        type={type}
        autoComplete={autocomplete}
        value={value}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `field-${name}-error` : undefined}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
      {error && (
        <p class="field-error" id={`field-${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

interface SummaryProps {
  errors: FieldErrors;
}

/** The `Check these details` alert: one link per invalid field, each moving focus to its field. */
export function ErrorSummary({ errors }: SummaryProps): JSX.Element | null {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div class="error-summary" role="alert">
      <h2>Check these details</h2>
      <ul>
        {entries.map(([name, message]) => (
          <li key={name}>
            <a
              href={`#field-${name}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`field-${name}`)?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TileProps {
  title: string;
  children: ComponentChildren;
}

export function FormTile({ title, children }: TileProps): JSX.Element {
  return (
    <section class="tile form-tile">
      <h1 class="page-title">{title}</h1>
      {children}
    </section>
  );
}
