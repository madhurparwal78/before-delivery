import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { StatusHandle } from '../lib/hooks';
import { statusLayer } from './layers';

/** A named status region: results appear on screen and are announced politely, once. */
export function StatusRegion({
  name,
  status,
}: {
  name: string;
  status: StatusHandle;
}): ReactNode {
  return createPortal(
    <p
      role="status"
      aria-label={name}
      aria-live="polite"
      className={`status-region status-${status.kind}`}
    >
      {status.kind === 'error' ? <AlertMark /> : null}
      {status.text}
    </p>,
    statusLayer(),
  );
}

export interface FieldError {
  readonly field: string;
  readonly message: string;
  readonly inputId: string;
}

/** The error summary: one link per field error, each moving focus to its field. */
export function ErrorSummary({ errors }: { errors: readonly FieldError[] }): ReactNode {
  if (errors.length === 0) return null;
  return (
    <div role="alert" aria-label="There is a problem" className="error-summary">
      <p className="error-summary-title">There is a problem</p>
      <ul>
        {errors.map((entry) => (
          <li key={entry.field}>
            <a
              href={`#${entry.inputId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(entry.inputId)?.focus();
              }}
            >
              {entry.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldMessage({ id, message }: { id: string; message?: string }): ReactNode {
  if (message === undefined) return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}

/** A drawn alert mark: it carries no text, so published copy reads character for character. */
export function AlertMark(): ReactNode {
  return (
    <svg
      className="alert-mark"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
    >
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.25" y="3.5" width="1.5" height="6" fill="currentColor" />
      <rect x="7.25" y="11" width="1.5" height="1.5" fill="currentColor" />
    </svg>
  );
}
