import type { ReactNode } from "react";
import type { RoomStatus } from "../shared/api";
import { formatMoney } from "../shared/money";
import { statusWords } from "../shared/notices";

export function Chip({ status, children }: { status: RoomStatus; children?: ReactNode }) {
  return (
    <span className="chip" data-status={status}>
      {status === "inspected" ? <CheckMark /> : null}
      {children ?? statusWords(status)}
    </span>
  );
}

function CheckMark() {
  return (
    <svg className="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5 5 9.5 10.5 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function KeyTag() {
  return (
    <svg className="icon key-tag" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
      <path d="M3 1h8l2 3v13H1V4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="5.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function Moon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M11.5 8.6A5 5 0 0 1 5.4 2.5a5 5 0 1 0 6.1 6.1z" fill="currentColor" />
    </svg>
  );
}

export function EmptySheet({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <svg width="96" height="64" viewBox="0 0 96 64" aria-hidden="true">
        <rect x="8" y="6" width="80" height="52" fill="none" stroke="currentColor" strokeWidth="1.2" />
        {[18, 28, 38, 48].map((y) => <line key={y} x1="8" x2="88" y1={y} y2={y} stroke="currentColor" strokeWidth="0.8" />)}
        <line x1="30" x2="30" y1="6" y2="58" stroke="currentColor" strokeWidth="0.8" />
        <path d="M64 20h14v8H64z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <p>{children}</p>
    </div>
  );
}

export interface FieldErrors { [field: string]: string }

/** Field labels the `Form errors` alert uses for a server field name. */
export function FormErrors({ errors, labels, onFollow }: { errors: FieldErrors; labels: Record<string, string>; onFollow: (field: string) => void }) {
  const fields = Object.keys(errors).filter((field) => labels[field]);
  if (fields.length === 0) return null;
  return (
    <div role="alert" aria-label="Form errors" className="form-errors">
      <ul>
        {fields.map((field) => (
          <li key={field}>
            <a
              href={`#field-${field}`}
              onClick={(event) => {
                event.preventDefault();
                onFollow(field);
              }}
            >
              {labels[field]}: {errors[field]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldMessage({ message }: { message?: string }) {
  return message ? <p className="field-error">{message}</p> : null;
}

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`money ${className}`}>{formatMoney(cents)}</span>;
}

