import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Errors = Record<string, string>;

/** Collects field errors and moves focus to the first field in error once they render. */
export function useFieldErrors() {
  const [errors, setErrorsState] = useState<Errors>({});
  const [version, setVersion] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const setErrors = useCallback((next: Errors) => { setErrorsState(next); setVersion((n) => n + 1); }, []);
  useEffect(() => {
    if (version === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [version]);
  return { errors, setErrors, formRef };
}

/** Guards a submit so a second click or Enter sends nothing while one request is in flight. */
export function useOnce() {
  const flying = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (job: () => Promise<void>) => {
    if (flying.current) return;
    flying.current = true;
    setPending(true);
    try { await job(); } finally { flying.current = false; setPending(false); }
  }, []);
  return { pending, run };
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid": boolean | undefined; "aria-describedby": string | undefined }) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": described })}
      {hint ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}

export function SubmitButton({ pending, pendingText, children, className }: { pending: boolean; pendingText: string; children: ReactNode; className?: string }) {
  return (
    <button type="submit" className={`btn btn-solid btn-cut ${className ?? ""}`} aria-disabled={pending || undefined}>
      {pending ? pendingText : children}
    </button>
  );
}
