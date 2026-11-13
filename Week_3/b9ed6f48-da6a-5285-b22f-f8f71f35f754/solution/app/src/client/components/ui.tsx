// Small shared pieces: the error summary, labelled fields, museum cards and icons.

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export type FieldErrors = Record<string, string>;

/** The `alert` at the top of a form or dialog: each field error is a link that focuses its field. */
export function ErrorSummary({ errors, message, ids }: { errors: FieldErrors; message?: string; ids: Record<string, string> }) {
  const entries = Object.entries(errors).filter(([field]) => ids[field]);
  if (!message && !entries.length) return null;
  return (
    <div role="alert" className="error-summary">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
        <path d="M12 3l9.5 17h-19L12 3zM12 10v4.5M12 17.2v.3" />
      </svg>
      <div>
        {message && <p>{message}</p>}
        {entries.length > 0 && (
          <ul>
            {entries.map(([field, text]) => (
              <li key={field}>
                <a
                  href={`#${ids[field]}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(ids[field])?.focus();
                  }}
                >
                  {text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  id: string;
}

export function Field({ label, error, hint, id, className, ...input }: FieldProps) {
  const hintId = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={[hint ? hintId : "", error ? `${id}-error` : ""].join(" ").trim() || undefined} {...input} />
    </div>
  );
}

export function TextArea({ label, error, id, ...input }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...input} />
    </div>
  );
}

/** A hairline-ruled museum card: catalogue number in mono, title in display type, then text. */
export function MuseumCard({ catalogue, title, children, className, headingLevel = 2 }: { catalogue: string; title: ReactNode; children?: ReactNode; className?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`museum-card ${className ?? ""}`} aria-label={typeof title === "string" ? title : undefined}>
      <p className="catalogue">{catalogue}</p>
      <Heading className="card-title">{title}</Heading>
      {children}
    </section>
  );
}

const PATHS = {
  bookmark: "M7 3.5h10v17l-5-4-5 4z",
  play: "M8 5v14l11-7z",
  pause: "M8 5h3v14H8zM13 5h3v14h-3z",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  menu: "M4 7h16M4 12h16M4 17h16",
  align: "M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  lens: "M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  rooms: "M4 20V9l8-5 8 5v11M9 20v-6h6v6",
} as const;

type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`icon${filled ? " icon-filled" : ""}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The drawn mark for empty states: a lens over scattered shards. */
export function EmptyMark() {
  return (
    <svg viewBox="0 0 96 64" aria-hidden="true" className="empty-mark">
      <path d="M10 50l6-9 5 7zM28 18l8-4-2 9zM70 44l9-3-3 8zM80 14l5 7-8 1zM52 52l7 2-5 5z" />
      <circle cx="48" cy="30" r="14" />
      <path d="M58 40l10 10" />
    </svg>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
