import { useEffect, useRef, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from 'react';

// The error summary and labelled fields every form shares.

export type FieldErrors = Record<string, string>;

export function ErrorSummary({ errors, ids, attempt }: { errors: FieldErrors; ids: Record<string, string>; attempt: number }) {
  const summary = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);
  useEffect(() => {
    if (attempt > 0) summary.current?.focus();
  }, [attempt]);
  if (entries.length === 0) return null;
  return (
    <div ref={summary} className="error-summary" role="alert" tabIndex={-1}>
      <h2>There is a problem</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${ids[field] ?? field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(ids[field] ?? field)?.focus();
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

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | undefined;
}

export function Field({ id, label, error, ...input }: FieldProps) {
  return (
    <div className={error ? 'field has-error' : 'field'}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} {...input} />
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  id: string;
  label: string;
  error?: string | undefined;
}

export function AreaField({ ref, id, label, error, ...area }: AreaProps) {
  return (
    <div className={error ? 'field has-error' : 'field'}>
      <label htmlFor={id}>{label}</label>
      <textarea ref={ref} id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} {...area} />
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function codePoints(value: string): number {
  return Array.from(value).length;
}

// A whole number typed into a box, or null when it is not one.
export function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 12) return null;
  for (const character of trimmed) if (character < '0' || character > '9') return null;
  return Number(trimmed);
}
