import type { ReactNode } from 'react';

/** A labelled field with its API message beside it. */
export function Field({ name, label, error, children, hint }: { name: string; label: string; error?: string; hint?: string; children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode }): ReactNode {
  const id = `field-${name}`;
  const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': note })}
      {hint && !error ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

const LABELS: Record<string, string> = {
  email: 'Email', password: 'Password', name: 'Name', country: 'Country', street: 'Street', postcode: 'Postcode', city: 'City', note: 'Note to workshop',
};

/** The summary that links to each field with a message. */
export function ErrorSummary({ errors, labels = LABELS }: { errors: Record<string, string>; labels?: Record<string, string> }): ReactNode {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary" role="alert" aria-label="Check these fields">
      <p className="h6">Check these fields</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#field-${field}`} onClick={(event) => { event.preventDefault(); document.getElementById(`field-${field}`)?.focus(); }}>{labels[field] ?? field}</a>: {message}
          </li>
        ))}
      </ul>
    </div>
  );
}
