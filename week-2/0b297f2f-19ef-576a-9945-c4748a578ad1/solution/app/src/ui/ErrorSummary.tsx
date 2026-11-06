import { forwardRef } from "react";
import { say } from "../copy";

export interface FieldError {
  /** id of the field the link moves focus to */
  fieldId: string;
  message: string;
}

/** Error summary (brief: Feedback states): the summary line, then one link per field error. */
export const ErrorSummary = forwardRef<HTMLDivElement, { errors: FieldError[] }>(function ErrorSummary({ errors }, ref) {
  if (!errors.length) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="error-summary" aria-labelledby="error-summary-title">
      <p id="error-summary-title" className="error-summary-title">
        {say.summary}
      </p>
      <ul>
        {errors.map((e) => (
          <li key={e.fieldId + e.message}>
            <a
              href={`#${e.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(e.fieldId)?.focus();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

export function FieldMessage({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" id={`${id}-error`}>
      {message}
    </p>
  );
}
