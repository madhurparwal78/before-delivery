// Documents: upload with an expiry date, the document table, and the operator's review.
import { FileText, Upload } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComplianceDocument, Tenant, User } from "../../shared/api";
import { DOCUMENT_KINDS, FILE_CAP_LABEL, HOLDER_MAX, KIND_LABELS, REASON_MAX, TENANT_STATUS_WORDS, type DocumentKind } from "../../shared/kitchen";
import { api, download, type ApiFailure } from "../api";
import { loadTenants } from "../data";
import { STORAGE_TRY_AGAIN, act, fieldError } from "../feedback";
import { Dialog, useCloseDialog } from "../ui/Dialog";
import { EmptyRow, Eyebrow, Field, PendingLine, describedBy, nextFieldId } from "../ui/parts";

const STATUS_WORDS = {
  pending_review: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
} as const;

function statusWord(doc: ComplianceDocument): string {
  return doc.status === "approved" && !doc.valid ? "Expired" : STATUS_WORDS[doc.status];
}

export function DocumentsScreen({ user }: { user: User }) {
  const isOperator = user.role === "operator";
  const [documents, setDocuments] = useState<ComplianceDocument[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [picked, setPicked] = useState<string>(user.tenant_id ?? "");
  const [rejecting, setRejecting] = useState<{ doc: ComplianceDocument; opener: HTMLElement } | null>(null);

  const load = async (mode: "load" | "refresh"): Promise<void> => {
    const outcome = await act({ pending: mode === "load" ? "Loading…" : undefined }, () =>
      Promise.all([api<{ documents: ComplianceDocument[] }>("GET", "/api/documents"), loadTenants()]),
    );
    if (!outcome.ok) return;
    const [docs, list] = outcome.value;
    setDocuments(docs.documents);
    setTenants(list);
    if (!picked && list[0]) setPicked(list[0].id);
  };
  const refresh = (): void => void load("refresh");

  useEffect(() => void load("load"), []);

  const business = (tenantId: string): string => tenants.find((t) => t.id === tenantId)?.business_name ?? tenantId;
  const pickedTenant = tenants.find((t) => t.id === picked) ?? null;

  const approve = async (doc: ComplianceDocument): Promise<void> => {
    const label = KIND_LABELS[doc.kind];
    const outcome = await act(
      {
        pending: "Approving…",
        services: ["storage"],
        success: () => `${label} for ${business(doc.tenant_id)} approved. The owner's email is queued.`,
        error: (f) => {
          if (f.code === "storage_unavailable") return "Document storage is unreachable, so the file can't be checked. Nothing was approved.";
          if (f.code === "file_missing") return "The stored file can't be read. Ask the tenant to upload it again.";
          return null;
        },
      },
      () => api<ComplianceDocument>("POST", `/api/documents/${doc.id}/approve`, { body: {} }),
    );
    if (outcome.ok) refresh();
  };

  const openFile = (doc: ComplianceDocument): void => {
    void act(
      {
        pending: "Opening file…",
        services: ["storage"],
        error: (f) => (f.code === "storage_unavailable" ? STORAGE_TRY_AGAIN : null),
      },
      () => download(`/api/documents/${doc.id}/file`, doc.file_name),
    );
  };

  return (
    <div class="sheet">
      <PendingLine />
      <header class="screen-head">
        <h1 class="screen-title">Documents</h1>
        {pickedTenant && (
          <p class="tenant-status">
            <span>{pickedTenant.business_name}</span>
            <span class={`badge mono badge-${pickedTenant.status}`}>{TENANT_STATUS_WORDS[pickedTenant.status]}</span>
          </p>
        )}
      </header>
      <UploadForm
        isOperator={isOperator}
        tenants={tenants}
        picked={picked}
        onPick={setPicked}
        onUploaded={refresh}
      />
      <Eyebrow n={2} label="Documents" />
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Documents">
          <thead>
            <tr role="row">
              {isOperator && <th role="columnheader">Business</th>}
              <th role="columnheader">Type</th>
              <th role="columnheader">Name on card</th>
              <th role="columnheader">Expiry date</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">File</th>
              {isOperator && <th role="columnheader">Review</th>}
            </tr>
          </thead>
          <tbody>
            {documents?.length === 0 && <EmptyRow columns={isOperator ? 7 : 5} text="No documents on file yet." />}
            {documents?.map((doc) => {
              const label = KIND_LABELS[doc.kind];
              const target = `${label} for ${business(doc.tenant_id)}, expires ${doc.expires_on}`;
              return (
                <tr role="row" key={doc.id}>
                  {isOperator && (
                    <td role="cell" data-label="Business">
                      {business(doc.tenant_id)}
                    </td>
                  )}
                  <td role="cell" data-label="Type" class="strong">
                    {label}
                  </td>
                  <td role="cell" data-label="Name on card">
                    {doc.holder_name ?? "—"}
                  </td>
                  <td role="cell" data-label="Expiry date" class="mono">
                    {doc.expires_on}
                  </td>
                  <td role="cell" data-label="Status">
                    <span class={`status doc-${doc.status}${doc.valid ? "" : " doc-invalid"}`}>{statusWord(doc)}</span>
                    {doc.rejection_reason && <span class="cell-note">{doc.rejection_reason}</span>}
                  </td>
                  <td role="cell" data-label="File">
                    <a
                      class="file-link"
                      href={`/api/documents/${doc.id}/file`}
                      onClick={(e) => {
                        e.preventDefault();
                        openFile(doc);
                      }}
                    >
                      <FileText size={16} aria-hidden="true" />
                      Open {label}
                    </a>
                  </td>
                  {isOperator && (
                    <td role="cell" data-label="Review" class="row-actions">
                      {doc.status === "pending_review" && (
                        <>
                          <button type="button" class="btn btn-small" aria-label={`Approve ${target}`} onClick={() => void approve(doc)}>
                            Approve
                          </button>
                          <button
                            type="button"
                            class="btn btn-small"
                            aria-label={`Reject ${target}`}
                            onClick={(e) => setRejecting({ doc, opener: e.currentTarget })}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rejecting && (
        <Dialog title="Reject document" opener={rejecting.opener} onClose={() => setRejecting(null)}>
          <RejectBody doc={rejecting.doc} business={business(rejecting.doc.tenant_id)} onDone={refresh} />
        </Dialog>
      )}
    </div>
  );
}

interface UploadProps {
  isOperator: boolean;
  tenants: Tenant[];
  picked: string;
  onPick: (tenantId: string) => void;
  onUploaded: () => void;
}

function UploadForm({ isOperator, tenants, picked, onPick, onUploaded }: UploadProps) {
  const [kind, setKind] = useState<DocumentKind>("certificate_of_insurance");
  const [expires, setExpires] = useState("");
  const [holder, setHolder] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = useRef({
    tenant: nextFieldId("doc-tenant"),
    kind: nextFieldId("doc-kind"),
    expires: nextFieldId("doc-expires"),
    holder: nextFieldId("doc-holder"),
    file: nextFieldId("doc-file"),
  }).current;

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const file = fileInput.current?.files?.[0] ?? null;
    const form = new FormData();
    if (isOperator) form.append("tenant_id", picked);
    form.append("kind", kind);
    form.append("expires_on", expires);
    if (kind === "food_handler_card") form.append("holder_name", holder);
    if (file) form.append("file", file, file.name);
    setBusy(true);
    const label = KIND_LABELS[kind];
    const outcome = await act(
      {
        pending: `Uploading ${file?.name ?? "document"}…`,
        services: ["storage"],
        success: () => `${label} uploaded. The kitchen will review it.`,
        error: (f) => {
          if (f.code === "file_too_large") return "That file is larger than the upload limit.";
          if (f.code === "unsupported_file_type") return "Only PDF, JPEG or PNG files are accepted. This file is not one of them.";
          if (f.code === "storage_unavailable") return "Document storage is unreachable. Nothing was uploaded; try again in a moment.";
          return null;
        },
      },
      () => api<ComplianceDocument>("POST", "/api/documents", { form }),
    );
    setBusy(false);
    if (outcome.ok) {
      setFailure(null);
      setHolder("");
      if (fileInput.current) fileInput.current.value = "";
      onUploaded();
    } else {
      setFailure(outcome.failure);
    }
  };

  const err = (field: string): string | null => fieldError(failure, field);

  return (
    <form class="upload-form" aria-label="Upload document" onSubmit={(e) => void submit(e)}>
      <Eyebrow n={1} label="Upload" />
      <h2>Upload a document</h2>
      <div class="form-grid">
        {isOperator && (
          <Field id={ids.tenant} label="Tenant" error={err("tenant_id")}>
            <select id={ids.tenant} value={picked} onChange={(e) => onPick(e.currentTarget.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.business_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id={ids.kind} label="Document type" error={err("kind")}>
          <select
            id={ids.kind}
            value={kind}
            aria-describedby={describedBy(ids.kind, err("kind"))}
            onChange={(e) => setKind(e.currentTarget.value as DocumentKind)}
          >
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={ids.expires} label="Expiry date" error={err("expires_on")}>
          <input
            id={ids.expires}
            type="date"
            class="mono"
            value={expires}
            aria-describedby={describedBy(ids.expires, err("expires_on"))}
            onInput={(e) => setExpires(e.currentTarget.value)}
          />
        </Field>
        {kind === "food_handler_card" && (
          <Field id={ids.holder} label="Name on card" error={err("holder_name")}>
            <input
              id={ids.holder}
              type="text"
              maxLength={HOLDER_MAX}
              value={holder}
              aria-describedby={describedBy(ids.holder, err("holder_name"))}
              onInput={(e) => setHolder(e.currentTarget.value)}
            />
          </Field>
        )}
        <Field id={ids.file} label="Document file" hint={`PDF, JPEG or PNG, up to ${FILE_CAP_LABEL}`} error={err("file")}>
          <input
            id={ids.file}
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            aria-describedby={describedBy(ids.file, err("file"), true)}
          />
        </Field>
      </div>
      <button type="submit" class="btn btn-primary" disabled={busy}>
        <Upload size={16} aria-hidden="true" />
        Upload document
      </button>
    </form>
  );
}

function RejectBody({ doc, business, onDone }: { doc: ComplianceDocument; business: string; onDone: () => void }) {
  const close = useCloseDialog();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useRef(nextFieldId("reason")).current;
  const label = KIND_LABELS[doc.kind];
  const copy = "Give a reason for the tenant.";

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const outcome = await act(
      {
        pending: "Sending rejection…",
        success: () => `${label} for ${business} rejected. The owner's email is queued.`,
        error: (f) => (f.code === "validation_failed" ? copy : null),
      },
      () => api<ComplianceDocument>("POST", `/api/documents/${doc.id}/reject`, { body: { reason } }),
    );
    setBusy(false);
    if (outcome.ok) {
      onDone();
      close();
    } else if (outcome.failure.code === "validation_failed") {
      setError(copy);
    }
  };

  return (
    <form class="dialog-form" onSubmit={(e) => void submit(e)}>
      <p class="dialog-lede">
        {label} for {business}, expires <span class="mono">{doc.expires_on}</span>
      </p>
      <Field id={id} label="Reason" error={error}>
        <textarea
          id={id}
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          aria-describedby={describedBy(id, error)}
          onInput={(e) => setReason(e.currentTarget.value)}
        />
      </Field>
      <div class="dialog-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>
          Send rejection
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
