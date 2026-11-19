// The one error summary every refused form renders through (brief: Interactions > Error summary).
import { useEffect, useId, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

export type FieldErrors = Record<string, string>;

/** Form error state: the server's field messages, plus a counter so a repeated refusal refocuses the summary. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [shown, setShown] = useState(0);
  return {
    errors,
    shown,
    show: (next: FieldErrors) => {
      setErrors(next);
      setShown((n) => n + 1);
    },
    clear: () => setErrors({}),
  };
}

/** aria wiring for one control: invalid flag and the message as its description. */
export function fieldAttrs(id: string, message: string | undefined, describedBy?: string) {
  const described = [message ? `${id}-error` : null, describedBy ?? null].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": message ? (true as const) : undefined,
    "aria-describedby": described || undefined,
  };
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={`${id}-error`}>
      <TriangleAlert size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

/**
 * `targets` maps each field key to the id of the control its link focuses (brief: liftLocal → Lift date,
 * expiresAt → Expires, body → Comment, authorName → Your name, plan → the first Plan radio).
 */
export function ErrorSummary({ errors, shown, targets }: { errors: FieldErrors; shown: number; targets: Record<string, string> }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const entries = Object.entries(errors);
  useEffect(() => {
    if (shown && ref.current) ref.current.focus();
  }, [shown]);
  if (!entries.length) return null;
  return (
    <div ref={ref} className="error-summary" role="alert" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId} className="error-summary__title">
        <TriangleAlert size={16} aria-hidden="true" />
        There is a problem
      </h2>
      <ul>
        {entries.map(([field, message]) => {
          const target = targets[field] ?? Object.values(targets)[0] ?? "";
          return (
            <li key={field}>
              <a
                href={`#${target}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(target)?.focus();
                }}
              >
                {message}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
