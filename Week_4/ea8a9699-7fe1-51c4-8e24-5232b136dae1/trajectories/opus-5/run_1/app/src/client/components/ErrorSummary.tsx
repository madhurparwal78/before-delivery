import { useEffect, useRef } from 'react';

export interface FormErrors {
  fields: Record<string, string>;
  /** Changes on every refusal so the summary takes focus again. */
  token: number;
}

export const noFormErrors: FormErrors = { fields: {}, token: 0 };

function fieldId(formName: string, field: string): string {
  return `${formName}-${field}`;
}

function fieldErrorId(formName: string, field: string): string {
  return `${formName}-${field}-error`;
}

interface ErrorSummaryProps {
  formName: string;
  errors: FormErrors;
}

export function ErrorSummary({ formName, errors }: ErrorSummaryProps): JSX.Element | null {
  const container = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors.fields);

  useEffect(() => {
    if (entries.length > 0) {
      container.current?.focus();
    }
  }, [errors.token, entries.length]);

  if (entries.length === 0) {
    return null;
  }
  return (
    <div
      className="form-error-summary"
      role="alert"
      aria-label="There is a problem"
      tabIndex={-1}
      ref={container}
    >
      <h2>There is a problem</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${fieldId(formName, field)}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(fieldId(formName, field));
                if (target instanceof HTMLElement) {
                  target.focus();
                }
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

export function fieldProps(
  formName: string,
  field: string,
  errors: FormErrors,
): { id: string; 'aria-invalid'?: 'true'; 'aria-describedby'?: string } {
  const message = errors.fields[field];
  if (message === undefined) {
    return { id: fieldId(formName, field) };
  }
  return {
    id: fieldId(formName, field),
    'aria-invalid': 'true',
    'aria-describedby': fieldErrorId(formName, field),
  };
}

export function FieldError({
  formName,
  field,
  errors,
}: {
  formName: string;
  field: string;
  errors: FormErrors;
}): JSX.Element | null {
  const message = errors.fields[field];
  if (message === undefined) {
    return null;
  }
  return (
    <span className="field-error warn" id={fieldErrorId(formName, field)}>
      {message}
    </span>
  );
}

