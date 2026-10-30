import { FileText, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, api, upload } from "../api.js";
import { Live, Select, type Message } from "../app.js";
import type { DocumentRecord } from "../types.js";

const KIND_WORDS: Record<DocumentRecord["kind"], string> = { liability: "Liability certificate", food_handler: "Food handler card" };

function statusWords(doc: DocumentRecord): string {
  switch (doc.status) {
    case "current": return "Current";
    case "expiring": return `Expires in ${doc.days_left} days`;
    case "expired": return "Expired";
    case "not_yet_valid": return "Not yet valid";
  }
}

export function Documents() {
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [kind, setKind] = useState<DocumentRecord["kind"]>("liability");
  const [validFrom, setValidFrom] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setDocuments((await api<{ documents: DocumentRecord[] }>("GET", "/api/documents")).documents), []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const form = new FormData();
    form.set("kind", kind);
    form.set("valid_from", validFrom.trim());
    form.set("expires_on", expiresOn.trim());
    const chosen = file.current?.files?.[0];
    if (chosen) form.set("file", chosen);
    setFieldErrors({});
    setMessage({ text: "Uploading…", tone: "pending" });
    try {
      await upload("/api/documents", form);
      setMessage({ text: "Document saved.", tone: "success" });
      if (file.current) file.current.value = "";
      await load();
    } catch (error) {
      if (!(error instanceof ApiFailure)) { setMessage({ text: "Uploading failed. Try again.", tone: "error" }); return; }
      const text = error.status === 415 ? "Files must be PDF, PNG or JPEG." : error.status === 413 ? "Files must be 5,000,000 bytes or smaller." : error.detail;
      setFieldErrors(error.body.fields ?? (error.status === 413 || error.status === 415 ? { file: text } : {}));
      setMessage({ text, tone: "error" });
    }
  };

  const error = (name: string) => fieldErrors[name] ? <span className="field-error" id={`${name}-error`}>{fieldErrors[name]}</span> : null;
  return (
    <main className="page documents-page">
      <header className="page-head">
        <h1>Documents</h1>
        <p className="lede">Keep your liability certificate and food handler card current. A booking confirms only when a stored certificate covers every date it touches.</p>
      </header>
      <form className="upload slip" onSubmit={(event) => void submit(event)} noValidate>
        <Select label="Document type" value={kind} onChange={(value) => setKind(value === "food_handler" ? "food_handler" : "liability")}>
          <option value="liability">Liability certificate</option>
          <option value="food_handler">Food handler card</option>
        </Select>
        <label className="field">
          <span>Valid from</span>
          <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="mono" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} aria-describedby={fieldErrors.valid_from ? "valid_from-error" : undefined} />
          {error("valid_from")}
        </label>
        <label className="field">
          <span>Expires on</span>
          <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="mono" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} aria-describedby={fieldErrors.expires_on ? "expires_on-error" : undefined} />
          {error("expires_on")}
        </label>
        <label className="field field-file">
          <span>Document file (PDF, PNG or JPEG)</span>
          <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg" aria-describedby={fieldErrors.file ? "file-error" : undefined} />
          {error("file")}
        </label>
        <button type="submit" className="button button-primary"><Upload aria-hidden="true" size={18} /><span>Upload document</span></button>
        <Live label="Documents status" message={message} />
      </form>
      <div className="table-frame" role="region" aria-label="Documents on file" tabIndex={0}>
        <table aria-label="My documents">
          <thead><tr><th scope="col">Type</th><th scope="col">Valid from</th><th scope="col">Expires on</th><th scope="col">Status</th><th scope="col">File</th></tr></thead>
          <tbody>
            {!documents ? <tr><td colSpan={5} className="loading-row">Loading…</td></tr> : documents.length === 0
              ? <tr><td colSpan={5} className="empty-row">Nothing on file yet. Upload your liability certificate to start booking.</td></tr>
              : documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{KIND_WORDS[doc.kind]}</td>
                  <td className="mono">{doc.valid_from}</td>
                  <td className="mono">{doc.expires_on}</td>
                  <td><span className={`doc-state doc-${doc.status}`}>{statusWords(doc)}</span></td>
                  <td><a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener" className="file-link"><FileText aria-hidden="true" size={16} /><span>Open {doc.content_type === "application/pdf" ? "PDF" : doc.content_type === "image/png" ? "PNG" : "JPEG"}</span></a></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
