import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { call, type ErrorBody, upload } from "../api";
import { Dialog } from "../Dialog";
import { usePaused, useSession } from "../session";
import type { DocumentType, MemberSummary, PaperDocument } from "../types";
import { type FormState, FormStatus, Page, StateBadge, Table } from "./common";

const LABELS: Record<DocumentType, string> = {
  insurance: "Insurance certificate",
  food_handler: "Food-handler card",
  kitchen_agreement: "Signed kitchen-use agreement",
};
const TYPES: DocumentType[] = ["insurance", "food_handler", "kitchen_agreement"];
const FILE_LIMIT = 5_000_000;

function uploadCopy(error: ErrorBody): { text: string; field: "file" | "expires" | null } {
  switch (error.error) {
    case "unsupported_type":
      return { text: "Upload a PDF, PNG or JPEG file.", field: "file" };
    case "file_too_large":
      return { text: "Files can be at most 5,000,000 bytes.", field: "file" };
    case "files_unavailable":
      return { text: "File storage is unreachable. Uploading is paused; try again shortly.", field: null };
    case "validation":
      if (error.errors?.expires_on) return { text: "Choose an expiry date from today onward.", field: "expires" };
      if (error.errors?.file) return { text: "That file name is not allowed. Rename the file and try again.", field: "file" };
      return { text: error.message, field: null };
    default:
      return { text: error.message, field: null };
  }
}

export function PapersScreen() {
  const { user, kitchen } = useSession();
  const operator = user.role === "operator";
  const uploadPaused = usePaused("upload_document");
  const openPaused = usePaused("view_document");
  const [documents, setDocuments] = useState<PaperDocument[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [type, setType] = useState<DocumentType>("insurance");
  const [expires, setExpires] = useState("");
  const [memberId, setMemberId] = useState("");
  const [fieldError, setFieldError] = useState<{ field: "file" | "expires"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PaperDocument | null>(null);
  const [reason, setReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await call<{ documents: PaperDocument[] }>("GET", "/api/documents");
    setLoading(false);
    if (result.ok) setDocuments(result.data.documents);
  }, []);

  useEffect(() => {
    void load();
    if (!operator) return;
    void (async () => {
      const result = await call<{ members: MemberSummary[] }>("GET", `/api/kitchens/${kitchen.id}/members`);
      if (result.ok) {
        setMembers(result.data.members);
        setMemberId((m) => m || (result.data.members[0]?.id ?? ""));
      }
    })();
  }, [load, operator, kitchen.id]);

  const business = (id: string): string => members.find((m) => m.id === id)?.business ?? "";
  const needsExpiry = type !== "kitchen_agreement";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    setFieldError(null);
    if (needsExpiry && (!expires || expires < kitchen.today)) {
      setFieldError({ field: "expires", text: "Choose an expiry date from today onward." });
      setForm({ text: "Choose an expiry date from today onward.", tone: "error" });
      return;
    }
    if (!file) {
      setFieldError({ field: "file", text: "Choose a PDF, PNG or JPEG file." });
      setForm({ text: "Upload a PDF, PNG or JPEG file.", tone: "error" });
      return;
    }
    if (file.size > FILE_LIMIT) {
      setFieldError({ field: "file", text: "Files can be at most 5,000,000 bytes." });
      setForm({ text: "Files can be at most 5,000,000 bytes.", tone: "error" });
      return;
    }
    const body = new FormData();
    body.set("type", type);
    if (needsExpiry) body.set("expires_on", expires);
    if (operator) body.set("member_id", memberId);
    body.set("file", file, file.name);
    setUploading(true);
    setForm({ text: "Uploading…", tone: "info" });
    void (async () => {
      const result = await upload<{ document: PaperDocument }>(body);
      setUploading(false);
      if (result.ok) {
        setForm({ text: `Uploaded ${result.data.document.label}. It counts once the kitchen verifies it.`, tone: "success" });
        if (fileRef.current) fileRef.current.value = "";
        void load();
        return;
      }
      const copy = uploadCopy(result.error);
      if (copy.field) setFieldError({ field: copy.field, text: copy.text });
      setForm({ text: copy.text, tone: "error" });
    })();
  };

  const review = (doc: PaperDocument, to: "verify" | "reject", why?: string): void => {
    setReviewing(doc.id);
    setForm({ text: "Saving…", tone: "info" });
    void (async () => {
      const result = await call<{ document: PaperDocument }>("POST", `/api/documents/${doc.id}/${to}`, to === "reject" ? { reason: why } : {});
      setReviewing(null);
      setRejecting(null);
      if (result.ok) {
        setForm({ text: `${to === "verify" ? "Verified" : "Rejected"} ${doc.label} for ${business(doc.member_id)}.`, tone: "success" });
        void load();
      } else if (result.error.error === "invalid_transition") {
        setForm({ text: `This document is already ${result.error.from ?? doc.state}.`, tone: "error" });
        void load();
      } else {
        setForm({ text: result.error.errors?.reason ?? result.error.message, tone: "error" });
      }
    })();
  };

  const fileLink = (doc: PaperDocument) => (
    <a
      className="text-link"
      href={`/api/documents/${doc.id}/file`}
      onClick={(event) => {
        if (!openPaused) return;
        event.preventDefault();
        setForm({ text: "File storage is unreachable. Opening documents is paused.", tone: "error" });
      }}
    >
      Open {doc.label}
    </a>
  );

  const toReview = documents.filter((d) => d.state === "uploaded");
  const memberColumn = { label: "Member", cell: (d: PaperDocument) => business(d.member_id) };
  const common = [
    { label: "Type", cell: (d: PaperDocument) => d.label },
    ...(operator ? [memberColumn] : []),
    { label: "Expires", cell: (d: PaperDocument) => <span className="num">{d.expires_on ?? "No expiry"}</span> },
    { label: "State", cell: (d: PaperDocument) => <StateBadge state={d.state} /> },
    { label: "File", cell: fileLink },
  ];

  return (
    <Page title="Papers">
      <FormStatus state={form} />
      <form aria-label="Upload document" className="upload-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="doc-type">Document type</label>
          <select id="doc-type" value={type} onChange={(e) => setType(TYPES.find((t) => t === e.target.value) ?? "insurance")}>
            <option value="insurance">{LABELS.insurance}</option>
            <option value="food_handler">{LABELS.food_handler}</option>
            {operator && <option value="kitchen_agreement">{LABELS.kitchen_agreement}</option>}
          </select>
        </div>
        {operator && (
          <div className="field">
            <label htmlFor="doc-member">Member</label>
            <select id="doc-member" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.business}
                </option>
              ))}
            </select>
          </div>
        )}
        {needsExpiry && (
          <div className={fieldError?.field === "expires" ? "field invalid" : "field"}>
            <label htmlFor="doc-expires">Expiry date</label>
            <input
              id="doc-expires"
              type="date"
              required
              min={kitchen.today}
              value={expires}
              aria-invalid={fieldError?.field === "expires" ? true : undefined}
              aria-describedby={fieldError?.field === "expires" ? "doc-expires-error" : undefined}
              onChange={(e) => setExpires(e.target.value)}
            />
            {fieldError?.field === "expires" && (
              <span id="doc-expires-error" className="field-error">
                {fieldError.text}
              </span>
            )}
          </div>
        )}
        <div className={fieldError?.field === "file" ? "field invalid" : "field"}>
          <label htmlFor="doc-file">File</label>
          <input
            id="doc-file"
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            aria-invalid={fieldError?.field === "file" ? true : undefined}
            aria-describedby={fieldError?.field === "file" ? "doc-file-error" : "doc-file-hint"}
          />
          {fieldError?.field === "file" ? (
            <span id="doc-file-error" className="field-error">
              {fieldError.text}
            </span>
          ) : (
            <span id="doc-file-hint" className="muted small">
              PDF, PNG or JPEG, up to 5,000,000 bytes.
            </span>
          )}
        </div>
        <button type="submit" className="primary" disabled={uploading || uploadPaused}>
          Upload
        </button>
      </form>

      {operator ? (
        <>
          <h2 className="section-title">Documents to review</h2>
          <Table
            label="Documents to review"
            loading={loading}
            rows={toReview}
            rowKey={(d) => d.id}
            empty="Nothing waiting for review."
            columns={[
              ...common,
              {
                label: "Review",
                cell: (d: PaperDocument) => (
                  <span className="row-actions">
                    <button type="button" className="ghost" disabled={reviewing !== null} onClick={() => review(d, "verify")}>
                      Verify
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={reviewing !== null}
                      onClick={() => {
                        setReason("");
                        setRejecting(d);
                      }}
                    >
                      Reject
                    </button>
                  </span>
                ),
              },
            ]}
          />
          {!loading && (
            <>
              <h2 className="section-title">All documents</h2>
              <Table label="All documents" rows={documents} rowKey={(d) => d.id} empty="No documents yet." columns={common} />
            </>
          )}
        </>
      ) : (
        <>
          <h2 className="section-title">My documents</h2>
          <Table label="My documents" loading={loading} rows={documents} rowKey={(d) => d.id} empty="No documents yet." columns={common} />
        </>
      )}

      <Dialog title="Reject document" open={rejecting !== null} onClose={() => setRejecting(null)}>
        {rejecting && (
          <form
            className="dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              review(rejecting, "reject", reason);
            }}
          >
            <p>
              {rejecting.label} for {business(rejecting.member_id)}
            </p>
            <label className="field">
              <span>Reason</span>
              <textarea maxLength={300} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="submit" className="danger" disabled={reason.trim() === "" || reviewing !== null}>
                Reject document
              </button>
              <button type="button" className="ghost" onClick={() => setRejecting(null)}>
                Back
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </Page>
  );
}
