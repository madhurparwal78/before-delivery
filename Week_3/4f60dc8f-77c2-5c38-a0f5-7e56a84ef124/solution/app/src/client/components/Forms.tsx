// Form pieces: labelled fields with inline errors, and the error summary that takes focus.
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

type FieldProps = {
  id: string;
  label: string;
  error?: string | undefined;
  value: string;
  onInput: (value: string) => void;
  type?: string;
  autocomplete?: string;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>["inputMode"];
  hint?: string;
  multiline?: boolean;
};

export function Field({ id, label, error, value, onInput, type = "text", autocomplete, inputMode, hint, multiline }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class="field" data-invalid={error ? "true" : "false"}>
      <label for={id}>{label}</label>
      {hint && (
        <p class="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {multiline ? (
        <textarea id={id} value={value} aria-describedby={describedBy} aria-invalid={error ? "true" : undefined} onInput={(e) => onInput(e.currentTarget.value)} />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          autocomplete={autocomplete}
          inputMode={inputMode}
          aria-describedby={describedBy}
          aria-invalid={error ? "true" : undefined}
          onInput={(e) => onInput(e.currentTarget.value)}
        />
      )}
    </div>
  );
}

/** "There is a problem": focused when it appears; each link moves focus to its field. */
export function ErrorSummary({ errors, fieldIds }: { errors: Record<string, string>; fieldIds: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);
  useEffect(() => {
    if (entries.length) ref.current?.focus();
  }, [errors]);
  if (!entries.length) return null;
  return (
    <div class="error-summary" role="alert" tabindex={-1} ref={ref} aria-labelledby="error-summary-title">
      <h2 id="error-summary-title">There is a problem</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${fieldIds[field] ?? field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(fieldIds[field] ?? field)?.focus();
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
