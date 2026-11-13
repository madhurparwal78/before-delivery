// Small shared controls: buttons that report busy, form fields with errors, the error summary, empty and failed states.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiFailure } from "./api";

export function useBusy(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return [busy, run];
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  busy?: boolean;
}

export function Button({ primary = false, busy = false, className = "", children, onClick, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn ${primary ? "btn-primary" : "btn-outline"} ${className}`.trim()}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (!busy) onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  children: (props: { id: string; "aria-invalid": boolean | undefined; "aria-describedby": string | undefined }) => ReactNode;
  hint?: string;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined })}
      {hint ? <p className="hint">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** `alert "Error"`: the API message and one link per field error that moves focus to the field. */
export function ErrorSummary({ failure, labels }: { failure: ApiFailure | null; labels?: Record<string, string> }) {
  if (!failure) return null;
  const entries = Object.entries(failure.fields);
  return (
    <div role="alert" aria-label="Error" className="error-box">
      <p>{failure.message}</p>
      {entries.length > 0 ? (
        <ul>
          {entries.map(([field, sentence]) => (
            <li key={field}>
              <a
                href={`#${field}`}
                onClick={(event) => {
                  event.preventDefault();
                  const target = document.querySelector<HTMLElement>(`[data-field="${field}"], [name="${field}"]`) ?? document.getElementById(field);
                  target?.focus();
                }}
              >
                {labels?.[field] ?? field}: {sentence}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EmptyBand({ line, children }: { line: string; children: ReactNode }) {
  return (
    <section className="empty-band" role="region" aria-label="Empty">
      <p>{line}</p>
      {children}
    </section>
  );
}

export function LoadFailed({ failure, onRetry }: { failure: ApiFailure; onRetry: () => void }) {
  return (
    <div role="alert" aria-label="Load failed" className="error-box outage">
      <p>{failure.message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="skeleton-row" />
      ))}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "danger" | "warning" | "healthy" | "info" | "plain"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const stateTone = (state: string): "danger" | "warning" | "healthy" | "plain" =>
  state === "active" ? "danger" : state === "pending" ? "warning" : state === "recovered" ? "healthy" : "plain";

/** A table box that scrolls sideways takes a Tab stop so a keyboard can scroll it; one that fits stays out of the Tab order. */
export function useFocusableScrollers(): void {
  useEffect(() => {
    const sync = (): void => {
      for (const box of document.querySelectorAll<HTMLElement>(".table-wrap")) {
        if (box.scrollWidth > box.clientWidth) box.tabIndex = 0;
        else box.removeAttribute("tabindex");
      }
    };
    const resize = new ResizeObserver(sync);
    const mutations = new MutationObserver(sync);
    resize.observe(document.body);
    mutations.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);
}
