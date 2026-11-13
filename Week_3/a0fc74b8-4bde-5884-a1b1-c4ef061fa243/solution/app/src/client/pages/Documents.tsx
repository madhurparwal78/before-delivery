import { Upload } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { STATUS_WORDS, GENERIC_FAILURE } from "../../shared/copy";
import type { DocumentJson, DocumentSummary } from "../../shared/types";
import { LedgerSheet } from "../components/Empty";
import { ServiceNotice, Status } from "../components/Regions";
import { ApiFailure, api, failureCopy } from "../lib/api";
import { utcMinute } from "../lib/format";
import { useLiveEvents } from "../lib/live";
import { Link, useRouter } from "../lib/router";
import { useMe } from "../lib/session";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "closed", label: "Declined or voided" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const UPLOAD_COPY: Record<string, string> = {
  not_a_pdf: "That file is not a PDF.",
  pdf_encrypted: "Password-protected PDFs can't be uploaded.",
  pdf_has_scripts: "PDFs with scripts can't be uploaded.",
  pdf_rotated: "Rotated pages aren't supported. Upload a PDF with upright pages.",
  too_many_pages: "This PDF has more than 60 pages.",
  too_large: "This PDF is larger than 25 MB.",
  storage_unavailable: "File storage is unavailable. Your PDF was not uploaded.",
};

function uploadFailure(error: unknown): string {
  if (error instanceof ApiFailure) {
    const known = UPLOAD_COPY[error.body.error ?? ""];
    if (known) return known;
    if (error.body.fields) return failureCopy(error, GENERIC_FAILURE);
  }
  return GENERIC_FAILURE;
}

export function Documents() {
  const me = useMe();
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<FilterId>("all");
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const known = useRef(new Map<string, string>());
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const load = useCallback(async () => {
    const result = await api.get<{ documents: DocumentSummary[] }>(`/api/documents?filter=${filter}`);
    const changed = result.documents.find((d) => known.current.has(d.id) && known.current.get(d.id) !== d.status);
    known.current = new Map(result.documents.map((d) => [d.id, d.status]));
    if (changed) setAnnouncement(`${changed.title}: ${STATUS_WORDS[changed.status]}`);
    setDocuments(result.documents);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveEvents((event) => {
    if (event.type === "resync" || event.type === "document") void load();
  });

  const upload = async (file: File) => {
    setPending(file.name);
    setAnnouncement(`Uploading ${file.name}...`);
    setUploadError("");
    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    try {
      const created = await api.post<DocumentJson>("/api/documents", form);
      navigate(`/documents/${created.id}`);
    } catch (error) {
      setUploadError(uploadFailure(error));
      refocus.current = true;
      setPending("");
    }
  };

  useEffect(() => {
    if (pending === "" && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [pending]);

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = FILTERS.length - 1;
    const move = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const target = FILTERS[move];
    if (!target) return;
    setFilter(target.id);
    tabs.current[move]?.focus();
  };

  const canUpload = me.role !== "viewer";
  return (
    <>
      <ServiceNotice />
      <Status label="Document updates" className="sr-only">
        {announcement}
      </Status>
      <h1>Documents</h1>
      {canUpload ? (
        <div className="upload-row">
          <label className="field-label grow">
            Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <button ref={trigger} type="button" className="btn" disabled={pending !== ""} aria-busy={pending !== ""} onClick={() => input.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            Upload PDF
          </button>
          <input ref={input} type="file" hidden onChange={chosen} tabIndex={-1} />
        </div>
      ) : null}
      {uploadError ? (
        <p role="alert" className="error">
          {uploadError}
        </p>
      ) : null}
      <div role="tablist" aria-label="Status filter" className="tabs">
        {FILTERS.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => void (tabs.current[index] = node)}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            tabIndex={filter === item.id ? 0 : -1}
            className="tab"
            onClick={() => setFilter(item.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {documents === null ? (
        <div className="skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : documents.length === 0 ? (
        <div className="empty">
          <LedgerSheet />
          <p>{filter === "all" ? "No documents yet. Upload a PDF to start one." : "Nothing here yet."}</p>
        </div>
      ) : (
        <>
          <table aria-label="Documents" className="table docs-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Next step</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
                  </td>
                  <td>
                    <span className="badge">{STATUS_WORDS[doc.status]}</span>
                  </td>
                  <td>{doc.nextStep}</td>
                  <td className="mono">{utcMinute(doc.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul aria-label="Documents" className="cards">
            {documents.map((doc) => (
              <li key={doc.id} className="card">
                <Link to={`/documents/${doc.id}`} className="card-title">
                  {doc.title}
                </Link>
                <span className="badge">{STATUS_WORDS[doc.status]}</span>
                <span>{doc.nextStep}</span>
                <span className="mono muted">{utcMinute(doc.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
