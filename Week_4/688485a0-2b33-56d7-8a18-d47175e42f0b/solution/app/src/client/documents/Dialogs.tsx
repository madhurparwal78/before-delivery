import { type ReactNode, type RefObject, useRef, useState } from "react";
import { plural } from "../../shared/display.js";
import type { JsonObject } from "../../shared/json.js";
import { asFailure, post } from "../api.js";
import { Dialog, useDialogClose } from "../components/Dialog.js";
import { useToast } from "../components/Toast.js";
import { queryErrorText } from "../copy.js";
import { useShell } from "../shell/ProjectShell.js";
import { bodyFromForm, type QueryForm } from "./useDocuments.js";

/** The three Documents dialogs: Save query, Load file and Download. */

const OUTAGE = "File storage is unavailable. Try again later.";

function useBase(): string {
  const { project, collection } = useShell();
  return `/api/projects/${project.id}/collections/${collection?.id ?? ""}`;
}

export function SaveQueryDialog({ form, onClose }: { form: QueryForm; onClose: () => void }): ReactNode {
  const base = useBase();
  const toast = useToast();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog name="Save query" onClose={onClose}>
      <SaveQueryBody
        busy={busy}
        name={name}
        message={message}
        onName={setName}
        onSave={async (close) => {
          const parsed = bodyFromForm(form);
          if ("error" in parsed) return setMessage(parsed.error);
          setBusy(true);
          setMessage("");
          try {
            const { filter, projection = null, sort = null, limit = 0 } = parsed.body;
            await post(`${base}/saved-queries`, { name, filter: filter as JsonObject, projection, sort, limit });
            toast("Query saved");
            close();
          } catch (error) {
            const failure = asFailure(error);
            setMessage(
              failure.body.error === "name_taken" ? "A saved query with this name already exists"
              : failure.body.error === "invalid_field" ? "Query name needs 1 to 80 characters"
              : queryErrorText(failure.body),
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </Dialog>
  );
}

function SaveQueryBody({ name, message, busy, onName, onSave }: { name: string; message: string; busy: boolean; onName: (name: string) => void; onSave: (close: () => void) => Promise<void> }): ReactNode {
  const close = useDialogClose();
  return (
    <form
      className="dialog-body stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void onSave(close);
      }}
    >
      <h2>Save this query</h2>
      <label className="field">
        <span className="field-label">Query name</span>
        <input className="input" data-autofocus value={name} onChange={(event) => onName(event.target.value)} />
      </label>
      <p className="status-line" role="status" aria-label="Save query status">
        {message}
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-ink" aria-disabled={busy || undefined}>
          Keep query
        </button>
      </div>
    </form>
  );
}

function FormatChoice({ value, onChange }: { value: "jsonl" | "csv"; onChange: (value: "jsonl" | "csv") => void }): ReactNode {
  return (
    <div role="radiogroup" aria-label="Format" className="radio-group">
      {(
        [
          ["jsonl", "JSON lines"],
          ["csv", "CSV"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="pill-radio">
          <input type="radio" name="file-format" checked={value === key} onChange={() => onChange(key)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

interface LineError {
  line: number;
  message: string;
}

export function LoadFileDialog({ onClose }: { onClose: () => void }): ReactNode {
  const base = useBase();
  const { recheckStorage } = useShell();
  const chooser = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"jsonl" | "csv">("jsonl");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<LineError[]>([]);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    setStatus("Loading file");
    setErrors([]);
    setLoadId(null);
    try {
      const response = await fetch(`${base}/imports?format=${format}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      const body = (await response.json()) as { error?: string; import_id?: string; inserted?: number; limit?: number; errors?: LineError[] };
      if (response.ok) {
        setLoadId(body.import_id ?? null);
        setStatus(`Imported ${plural(body.inserted ?? 0, "document")}`);
      } else if (body.error === "import_failed") {
        setLoadId(body.import_id ?? null);
        setErrors(body.errors ?? []);
        setStatus("Import failed");
      } else if (body.error === "too_many_lines") {
        setStatus(`File has more than ${body.limit} lines`);
      } else if (body.error === "storage_unavailable") {
        setStatus(OUTAGE);
        void recheckStorage();
      } else {
        setStatus("The file could not be loaded");
      }
    } catch {
      setStatus("The file could not be loaded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog name="Load file" onClose={onClose}>
      <LoadBody
        onLoad={() => void load()}
        busy={busy}
        file={file}
        chooser={chooser}
        onChoose={(chosen) => {
          setFile(chosen);
          if (chosen) setFormat(chosen.name.toLowerCase().endsWith(".csv") ? "csv" : "jsonl");
        }}
        format={format}
        onFormat={setFormat}
        status={status}
        errors={errors}
        original={loadId ? `${base}/imports/${loadId}/original` : null}
      />
    </Dialog>
  );
}

interface LoadBodyProps {
  onLoad: () => void;
  busy: boolean;
  file: File | null;
  chooser: RefObject<HTMLInputElement | null>;
  onChoose: (file: File | null) => void;
  format: "jsonl" | "csv";
  onFormat: (format: "jsonl" | "csv") => void;
  status: string;
  errors: LineError[];
  original: string | null;
}

function LoadBody({ onLoad, busy, file, chooser, onChoose, format, onFormat, status, errors, original }: LoadBodyProps): ReactNode {
  const close = useDialogClose();
  return (
    <div className="dialog-body stack">
      <h2>Load a file</h2>
      <p className="muted">Every line is checked first. If any line is bad, nothing is added.</p>
      <input ref={chooser} type="file" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => onChoose(event.target.files?.[0] ?? null)} />
      <div className="actions">
        <button type="button" className="btn" data-autofocus onClick={() => chooser.current?.click()}>
          Choose file
        </button>
        <span className="muted file-name">{file ? file.name : "No file chosen"}</span>
      </div>
      <FormatChoice value={format} onChange={onFormat} />
      <p className="status-line" role="status" aria-label="Import status" aria-busy={busy || undefined}>
        {status}
      </p>
      {errors.length > 0 ? (
        <ul className="line-errors" role="list" aria-label="Line errors">
          {errors.map((error) => (
            <li key={`${error.line}-${error.message}`}>
              Line {error.line}: {error.message}
            </li>
          ))}
        </ul>
      ) : null}
      {original ? (
        <a className="text-link" href={original} download>
          Download original file
        </a>
      ) : null}
      <div className="actions">
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
        <button type="button" className="btn btn-ink" onClick={onLoad} aria-disabled={busy || !file || undefined}>
          Load
        </button>
      </div>
    </div>
  );
}

export function DownloadDialog({ applied, onClose }: { applied: JsonObject | null; onClose: () => void }): ReactNode {
  const base = useBase();
  const { recheckStorage } = useShell();
  const [format, setFormat] = useState<"jsonl" | "csv">("jsonl");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const download = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus("Preparing download");
    try {
      const made = await post<{ download_url: string }>(`${base}/exports`, { format, filter: applied?.["filter"] ?? {}, sort: applied?.["sort"] ?? null });
      const link = document.createElement("a");
      link.href = made.download_url;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus("Download started");
    } catch (error) {
      const failure = asFailure(error);
      if (failure.body.error === "storage_unavailable") {
        setStatus(OUTAGE);
        void recheckStorage();
      } else {
        setStatus(queryErrorText(failure.body));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog name="Download" onClose={onClose}>
      <DownloadBody format={format} onFormat={setFormat} status={status} busy={busy} onDownload={() => void download()} />
    </Dialog>
  );
}

function DownloadBody({ format, onFormat, status, busy, onDownload }: { format: "jsonl" | "csv"; onFormat: (format: "jsonl" | "csv") => void; status: string; busy: boolean; onDownload: () => void }): ReactNode {
  const close = useDialogClose();
  return (
    <div className="dialog-body stack">
      <h2>Download documents</h2>
      <p className="muted">Every document that matches the current filter and sort, not just this page.</p>
      <FormatChoice value={format} onChange={onFormat} />
      <p className="status-line" role="status" aria-label="Download status" aria-busy={busy || undefined}>
        {status}
      </p>
      <div className="actions">
        <button type="button" className="btn" data-autofocus onClick={close}>
          Close
        </button>
        <button type="button" className="btn btn-ink" onClick={onDownload} aria-disabled={busy || undefined}>
          Download file
        </button>
      </div>
    </div>
  );
}
