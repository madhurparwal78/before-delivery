import { useRef, useState } from "react";
import { importFileName } from "../../shared/files.ts";
import { announce } from "../announce.tsx";
import { editorRequest, errorBody, readJson } from "../api.ts";
import { Modal } from "../modal.tsx";

const ERRORS: Record<string, string> = {
  file_too_large: "This file is too large to import.",
  unsupported_file_type: "Only diagram XML and SVG files can be imported.",
  unsafe_file: "This file contains scripts, external entities or unsafe links and was not imported.",
  invalid_model: "This file does not describe a valid diagram.",
};

export interface Imported {
  pageId: string;
  pageName: string;
}

export function ImportDialog({ diagramId, onClose, onImported, onStorageDown, onFailure }: {
  diagramId: string; onClose(): void; onImported(result: Imported): void; onStorageDown(): void; onFailure(): void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file || busy) return;
    const name = importFileName(file.name);
    setBusy(true);
    announce(`Importing ${name}...`);
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await editorRequest({ method: "POST", path: `/api/diagrams/${diagramId}/imports`, form });
    setBusy(false);
    if (res.status === 201) {
      const body = await readJson<{ import: { pageId: string; fileName: string } }>(res);
      announce(`Imported ${body.import.fileName} as a new page.`);
      onImported({ pageId: body.import.pageId, pageName: `Imported ${body.import.fileName}` });
      return;
    }
    const code = (await errorBody(res))?.error ?? "";
    if (code === "storage_unavailable") {
      onStorageDown();
      input.current?.focus();
      return;
    }
    const message = ERRORS[code];
    if (!message) {
      onFailure();
      return;
    }
    setError(message);
    announce(message);
    input.current?.focus();
  };

  return (
    <Modal kind="dialog" label="Import diagram file" onClose={onClose}>
      <header className="dialog-head"><h2>Import diagram file</h2></header>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="dialog-text">Diagram XML or SVG up to 2 MB. The original file is kept as evidence beside the new page.</p>
        <div className="field">
          <label htmlFor="import-file">Diagram file</label>
          <input
            id="import-file"
            ref={input}
            type="file"
            accept=".xml,.svg,application/xml,text/xml,image/svg+xml"
            aria-describedby={error ? "import-error" : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          {error && <p className="field-error" id="import-error">{error}</p>}
        </div>
        <footer className="dialog-foot">
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>{busy ? "Importing..." : "Import file"}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </footer>
      </form>
    </Modal>
  );
}
