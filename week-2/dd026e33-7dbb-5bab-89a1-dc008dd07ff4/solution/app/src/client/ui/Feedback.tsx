// Named status regions, the error summary and field error text (brief: Feedback states).
import { useCallback, useState, type ReactNode } from "react";
import type { Startup } from "../../shared/api.js";
import { startupLabel } from "../labels.js";
import { Icon } from "./Icon.js";

interface Note {
  text: string;
  tone: "info" | "error";
}

const SILENT: Note = { text: "", tone: "info" };

/** One status region's text: pending, success and error replace each other; re-reads never call it. */
export function useNote(): [Note, (text: string, tone?: Note["tone"]) => void] {
  const [note, setNote] = useState<Note>(SILENT);
  const say = useCallback((text: string, tone: Note["tone"] = "info") => setNote({ text, tone }), []);
  return [note, say];
}

export function StatusRegion({ name, note, className }: { name: string; note: Note; className?: string }): JSX.Element {
  return (
    <div role="status" aria-label={name} className={`status ${note.tone === "error" ? "status-error" : ""} ${className ?? ""}`}>
      {note.text ? (
        <>
          {note.tone === "error" ? <Icon name="alert" /> : null}
          {note.text}
        </>
      ) : null}
    </div>
  );
}

interface SummaryItem {
  field: string;
  message: string;
}

/** The form's "There is a problem" alert, one link per field error. */
export function ErrorSummary({
  items,
  idFor,
  extra,
}: {
  items: SummaryItem[];
  idFor: (field: string) => string;
  extra?: ReactNode;
}): JSX.Element | null {
  if (items.length === 0 && !extra) return null;
  return (
    <div role="alert" aria-label="There is a problem" className="error-summary">
      <p className="error-summary-title">
        <Icon name="alert" />
        There is a problem
      </p>
      {extra}
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.field}>
              <a
                href={`#${idFor(item.field)}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(idFor(item.field))?.focus();
                }}
              >
                {item.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }): JSX.Element | null {
  return message ? (
    <p className="field-error" id={id}>
      {message}
    </p>
  ) : null;
}

export function summaryOf(errors: Record<string, string>, order: string[]): SummaryItem[] {
  const known = order.filter((field) => errors[field]);
  const rest = Object.keys(errors).filter((field) => !order.includes(field));
  return [...known, ...rest].map((field) => ({ field, message: errors[field] ?? "" }));
}

/** A car's server-decided start-up status; overdue carries the alert icon as well as its text. */
export function StartupBadge({ startup }: { startup: Startup }): JSX.Element {
  return startup.status === "overdue" ? (
    <span className="badge badge-alert">
      <Icon name="alert" size={16} />
      {startupLabel(startup)}
    </span>
  ) : (
    <span className="badge">{startupLabel(startup)}</span>
  );
}
