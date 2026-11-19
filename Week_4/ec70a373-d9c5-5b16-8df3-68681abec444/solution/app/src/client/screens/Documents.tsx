// Documents: coverage by type, the upload form, and the member's documents.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { DOCUMENT_TYPE_LABELS, type DocumentRecord, type DocumentType, type Me, type ValidThrough } from "../../shared/api.ts";
import { addDays } from "../../shared/time.ts";
import { validThroughLapsed } from "../../shared/rules.ts";
import { api, download, errorCopy } from "../api.ts";
import { useSites } from "../useSites.ts";
import { EmptyState, Status, useFieldErrors, useStatusRegion } from "../ui.tsx";

const TYPES: DocumentType[] = ["certificate_of_insurance", "food_handler_certificate", "business_licence"];
const NEAR_EXPIRY_DAYS = 14;

function statusText(d: DocumentRecord): string {
  if (d.status === "pending") return "Pending review";
  if (d.status === "verified") return "Verified";
  return `Rejected: ${d.rejection_reason ?? ""}`;
}

export const OPEN_FILE_ERRORS = { storage_unavailable: "This file can't be opened right now. Try again shortly." };

export function Documents({ me }: { me: Me }): ReactNode {
  const legalName = me.user.tenant.legal_name;
  const [coverage, setCoverage] = useState<ValidThrough | null>(me.member?.valid_through ?? null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [type, setType] = useState<DocumentType>("certificate_of_insurance");
  const [expiry, setExpiry] = useState("");
  const [limit, setLimit] = useState("");
  const [namesInsured, setNamesInsured] = useState(false);
  const errors = useFieldErrors();
  const [status, say] = useStatusRegion();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sites = useSites();

  useEffect(() => {
    void api<{ documents: DocumentRecord[] }>("/api/documents").then((list) => {
      if (list.ok) setDocuments(list.data.documents);
    });
    void api<Me>("/api/me").then((mine) => {
      if (mine.ok && mine.data.member) setCoverage(mine.data.member.valid_through);
    });
  }, []);

  const today = sites.find((s) => s.id === me.member?.home_site_id)?.local_date ?? "";
  const isInsurance = type === "certificate_of_insurance";
  const uploadErrors: Record<string, string> = {
    per_occurrence_limit: "Coverage must be at least $1,000,000 per occurrence.",
    names_additional_insured: `The certificate must name ${legalName} as additional insured.`,
    expiry_date: "Enter the expiry date shown on the document.",
    file: "Choose a file to upload.",
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const form = new FormData();
    form.set("type", type);
    form.set("expiry_date", expiry);
    if (isInsurance) {
      form.set("per_occurrence_limit", limit.replace(/[$,\s]/g, ""));
      if (namesInsured) form.set("names_additional_insured", "true");
    }
    const file = fileInput.current?.files?.[0];
    if (file) form.set("file", file);
    setBusy(true);
    errors.clearAll();
    say("Uploading…");
    const result = await api<{ document: DocumentRecord }>("/api/documents", { method: "POST", form });
    setBusy(false);
    if (result.ok) {
      say(`Uploaded ${DOCUMENT_TYPE_LABELS[type]}. It is waiting for review.`);
      setDocuments((list) => [result.data.document, ...list]);
      setExpiry("");
      setLimit("");
      setNamesInsured(false);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (result.error?.code === "validation") {
      const named = Object.keys(uploadErrors).filter((f) => result.error && f in (result.error.fields ?? {}));
      for (const f of named) errors.set(f, uploadErrors[f] ?? "");
      const first = named[0];
      say(first ? (uploadErrors[first] ?? "") : errorCopy(result, {}), "error");
      return;
    }
    say(
      errorCopy(result, {
        unsupported_type: "Upload a PDF, PNG or JPEG file.",
        file_too_large: "Files can be at most 5,000,000 bytes.",
        body_too_large: "Files can be at most 5,000,000 bytes.",
        storage_unavailable: "Document storage is unreachable. Nothing was uploaded; try again shortly.",
      }),
      "error",
    );
  };

  return (
    <div className="screen documents">
      <h1 className="screen-title">Documents</h1>
      <div className="split">
        <div className="split-main">
          <section aria-labelledby="coverage-title">
            <h2 id="coverage-title">Coverage</h2>
            <ul role="list" aria-label="Coverage" className="coverage">
              {TYPES.map((t) => {
                const date = coverage?.[t] ?? null;
                const expired = date !== null && today !== "" && validThroughLapsed(date, today);
                const near = date !== null && today !== "" && !expired && date <= addDays(today, NEAR_EXPIRY_DAYS);
                return (
                  <li key={t} className={`coverage-line${expired || near ? " coverage-alert" : ""}`}>
                    {(expired || near) && <span className="lot-notch" aria-hidden="true" />}
                    <span>
                      {DOCUMENT_TYPE_LABELS[t]}:{" "}
                      {date === null ? (
                        "none on file"
                      ) : (
                        <>
                          {expired ? "expired" : "valid through"} <span className="mono">{date}</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="docs-title">
            <h2 id="docs-title">Your documents</h2>
            <table role="table" aria-label="Your documents" className="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Type</th>
                  <th role="columnheader" scope="col">Expiry</th>
                  <th role="columnheader" scope="col">Status</th>
                  <th role="columnheader" scope="col">File</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {documents.map((d) => (
                  <tr role="row" key={d.id}>
                    <td role="cell" data-label="Type">{DOCUMENT_TYPE_LABELS[d.type]}</td>
                    <td role="cell" data-label="Expiry" className="mono">{d.expiry_date}</td>
                    <td role="cell" data-label="Status" className={d.status === "verified" ? "text-green" : undefined}>
                      {statusText(d)}
                    </td>
                    <td role="cell" data-label="File">
                      <a
                        className="text-link"
                        href={`/api/documents/${d.id}/file`}
                        onClick={async (event) => {
                          event.preventDefault();
                          const result = await download(`/api/documents/${d.id}/file`);
                          if (!result.ok) say(errorCopy(result, OPEN_FILE_ERRORS), "error");
                        }}
                      >
                        <FileText aria-hidden="true" size={16} /> Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {documents.length === 0 && <EmptyState drawing="clipboard">No documents uploaded yet.</EmptyState>}
          </section>
        </div>
        <section className="split-side" aria-labelledby="upload-title">
          <h2 id="upload-title">Upload a document</h2>
          <form
            className="form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label htmlFor="doc-type">Document type</label>
              <select id="doc-type" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doc-expiry">Expiry date</label>
              <input
                id="doc-expiry"
                type="date"
                value={expiry}
                {...errors.attrs("expiry_date")}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  errors.clear("expiry_date");
                }}
              />
              {errors.node("expiry_date")}
            </div>
            {isInsurance && (
              <>
                <div className="field">
                  <label htmlFor="doc-limit">Coverage per occurrence (USD)</label>
                  <input
                    id="doc-limit"
                    type="text"
                    inputMode="numeric"
                    value={limit}
                    {...errors.attrs("per_occurrence_limit")}
                    onChange={(e) => {
                      setLimit(e.target.value);
                      errors.clear("per_occurrence_limit");
                    }}
                  />
                  {errors.node("per_occurrence_limit")}
                </div>
                <div className="field">
                  <div className="check">
                    <input
                      id="doc-insured"
                      type="checkbox"
                      checked={namesInsured}
                      {...errors.attrs("names_additional_insured")}
                      onChange={(e) => {
                        setNamesInsured(e.target.checked);
                        errors.clear("names_additional_insured");
                      }}
                    />
                    <label htmlFor="doc-insured">Names {legalName} as additional insured</label>
                  </div>
                  {errors.node("names_additional_insured")}
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="doc-file">File</label>
              <input
                id="doc-file"
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                {...errors.attrs("file")}
                aria-describedby={[errors.attrs("file")["aria-describedby"], "doc-file-hint"].filter(Boolean).join(" ")}
                onChange={() => errors.clear("file")}
              />
              {errors.node("file")}
              <p className="hint" id="doc-file-hint">
                PDF, PNG or JPEG, up to 5,000,000 bytes
              </p>
            </div>
            <button type="submit" className="button button-primary" aria-disabled={busy}>
              Upload document
            </button>
            <Status name="Document status" message={status} />
          </form>
        </section>
      </div>
    </div>
  );
}
