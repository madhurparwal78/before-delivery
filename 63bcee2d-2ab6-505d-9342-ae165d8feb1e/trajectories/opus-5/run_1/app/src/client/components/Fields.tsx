/** Fields, their error text and the error summary that moves focus to each one. */

import { useCallback, useId, useState, type ReactNode } from 'react';
import { focusWhenReady } from '../lib/focus.js';

export type FieldErrors = Record<string, string>;

export interface FormErrors {
  errors: FieldErrors;
  set: (errors: FieldErrors) => void;
  clear: () => void;
  firstPath: string | null;
}

export function useFormErrors(): FormErrors {
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = useCallback((next: FieldErrors) => setErrors(next), []);
  const clear = useCallback(() => setErrors({}), []);
  return { errors, set, clear, firstPath: Object.keys(errors)[0] ?? null };
}

export function fieldDomId(formId: string, path: string): string {
  return `${formId}-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
}

export function errorDomId(formId: string, path: string): string {
  return `${fieldDomId(formId, path)}-error`;
}

/** Moves focus to a refused field's error text. */
export function focusFieldError(formId: string, path: string): void {
  focusWhenReady(`#${CSS.escape(errorDomId(formId, path))}`);
}

export function Field({
  formId,
  path,
  label,
  errors,
  hint,
  children,
}: {
  formId: string;
  path: string;
  label: string;
  errors: FieldErrors;
  hint?: ReactNode;
  children: (attributes: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}): JSX.Element {
  const id = fieldDomId(formId, path);
  const message = errors[path];
  const describedBy = message ? errorDomId(formId, path) : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {hint ? <p className="field-hint">{hint}</p> : null}
      {children({
        id,
        'aria-invalid': message ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {message ? (
        <p className="field-error" id={errorDomId(formId, path)} tabIndex={-1}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorSummary({
  formId,
  errors,
  heading = 'Check these fields',
}: {
  formId: string;
  errors: FieldErrors;
  heading?: string;
}): JSX.Element | null {
  const headingId = useId();
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary" role="group" aria-labelledby={headingId}>
      <p className="error-summary-heading" id={headingId}>
        {heading}
      </p>
      <ul>
        {entries.map(([path, message]) => (
          <li key={path}>
            <a
              href={`#${fieldDomId(formId, path)}`}
              onClick={(event) => {
                event.preventDefault();
                const node = document.getElementById(fieldDomId(formId, path));
                if (node instanceof HTMLElement) node.focus();
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
