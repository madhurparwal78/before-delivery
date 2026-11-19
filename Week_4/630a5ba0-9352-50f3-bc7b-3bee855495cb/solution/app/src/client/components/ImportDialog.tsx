import { useEffect, useId, useState } from "react";
import { api, ApiFailure, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";
import { Dialog } from "./Dialog.js";

const FILE_LIMIT = 1_000_000;
const TOO_LARGE = "That file is larger than 1,000,000 bytes.";

type TaskSummary = { created: number; updated: number; unchanged: number; merged: number; rejected: unknown[]; orphaned: unknown[] };
type CalendarSummary = { created: number; updated: number; unchanged: number; skipped: number };

function taskCopy(s: TaskSummary): string {
  let copy = `Imported: ${s.created} new, ${s.updated} updated, ${s.unchanged} unchanged.`;
  if (s.merged) copy += ` ${s.merged} merged.`;
  if (s.rejected.length) copy += ` ${s.rejected.length} rows skipped.`;
  if (s.orphaned.length) copy += ` ${s.orphaned.length} not in this file.`;
  return copy;
}

const KINDS = {
  tasks: {
    title: "Import tasks",
    field: "CSV export",
    accept: ".csv,text/csv",
    type: "text/csv",
    endpoint: "/api/imports/tasks",
    hint: "A CSV with external_id and title columns; estimate_minutes, due_date and source are optional.",
  },
  calendar: {
    title: "Import calendar",
    field: "Calendar file (.ics)",
    accept: ".ics,text/calendar",
    type: "text/calendar",
    endpoint: "/api/imports/calendar",
    hint: "Timed events become meetings. All-day and repeating events are skipped.",
  },
} as const;

type Props = { kind: "tasks" | "calendar"; open: boolean; onClose: () => void; onImported: () => void };

export function ImportDialog({ kind, open, onClose, onImported }: Props) {
  const meta = KINDS[kind];
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();

  useEffect(() => {
    if (open) {
      setFile(null);
      setSummary(null);
      setError(null);
    }
  }, [open]);

  const run = async () => {
    if (!file) {
      setError(`Choose a ${kind === "tasks" ? "CSV export" : "calendar file"} first.`);
      return;
    }
    if (file.size > FILE_LIMIT) {
      setError(TOO_LARGE);
      announce(TOO_LARGE);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const text = await file.text();
      const result = await api<TaskSummary & CalendarSummary>("POST", meta.endpoint, { raw: { text, type: meta.type } });
      const copy =
        kind === "tasks"
          ? taskCopy(result)
          : `Calendar imported: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped.`;
      setSummary(copy);
      announce(copy);
      onImported();
    } catch (failure) {
      let copy = SERVER_ERROR;
      if (failure instanceof ApiFailure) {
        if (failure.status === 413) copy = TOO_LARGE;
        else if (failure.code === "not_a_task_export") copy = "That file isn't a task export with external_id and title columns.";
        else if (failure.code === "too_many_rows") copy = "That file has more than 2,000 rows.";
        else if (failure.code === "not_a_calendar") copy = "That file isn't an iCalendar file.";
        else if (failure.code === "workspace_read_only") copy = "This workspace is read-only. Planning resumes when the subscription is active.";
      }
      setSummary(null);
      setError(copy);
      announce(copy);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title={meta.title} open={open} onClose={onClose}>
      <div className="field">
        <label className="field-label" htmlFor={fieldId}>
          {meta.field}
        </label>
        <input
          id={fieldId}
          className="file-input"
          type="file"
          accept={meta.accept}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setError(null);
          }}
        />
        <p id={hintId} className="field-hint">
          {meta.hint}
        </p>
        {error && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
      </div>
      {summary && <p className="import-summary">{summary}</p>}
      <div className="dialog-actions">
        <button type="button" className="button button-strong" aria-busy={pending} disabled={pending} onClick={() => void run()}>
          {pending ? "Importing…" : "Import"}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
