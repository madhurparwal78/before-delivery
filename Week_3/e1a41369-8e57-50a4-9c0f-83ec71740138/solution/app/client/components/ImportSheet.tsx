import { AlertTriangle, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { ImportRecord } from "../../shared/api";
import { ApiError, GENERIC_FAILURE, api, lineErrors } from "../api";
import { plural } from "../format";
import { Sheet, useSheetClose } from "./Sheet";

const COPY: Record<string, string> = {
  file_too_large: "The file is larger than 100,000 bytes.",
  unsupported_file_type: "Choose a .deedlist text file.",
  storage_unavailable: "File storage is unavailable. Nothing was imported.",
};

interface Outcome {
  imported?: number;
  lines?: string[];
  failure?: string;
}

function ImportForm() {
  const close = useSheetClose();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setOutcome({});
    const body = new FormData();
    body.append("file", file!);
    try {
      const record = await api<ImportRecord>("POST", "/api/imports", body);
      setOutcome({ imported: record.taskCount });
    } catch (error) {
      const lines = lineErrors(error);
      if (lines) setOutcome({ lines: lines.map((item) => item.message) });
      else setOutcome({ failure: (error instanceof ApiError && error.body.error && COPY[error.body.error]) || GENERIC_FAILURE });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor="import-file">Task list file</label>
      <input id="import-file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <p className="hint">A .deedlist text file, up to 100,000 bytes.</p>
      {outcome.lines && (
        <ul className="errors" role="list" aria-label="Import errors">
          {outcome.lines.map((message) => (
            <li key={message}>
              <AlertTriangle aria-hidden="true" size={18} />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      )}
      {outcome.failure && <p className="field-error" role="alert">{outcome.failure}</p>}
      {outcome.imported !== undefined && <p className="success" role="status">{`Imported ${plural(outcome.imported, "task")}`}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={pending || !file}>{pending ? "Importing..." : "Import"}</button>
        <button type="button" className="btn" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

export function ImportTrigger() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" className="btn" ref={opener} onClick={() => setOpen(true)}>
        <Upload aria-hidden="true" size={18} /> Import tasks
      </button>
      {open && (
        <Sheet
          title="Import tasks"
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        >
          <ImportForm />
        </Sheet>
      )}
    </>
  );
}
