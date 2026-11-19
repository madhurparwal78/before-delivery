// Compliance: documents awaiting review from members homed at the manager's site.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DOCUMENT_TYPE_LABELS, type DocumentRecord } from "../../shared/api.ts";
import { siteDateTime } from "../../shared/format.ts";
import { api, download, errorCopy } from "../api.ts";
import { useSites } from "../useSites.ts";
import { ActionButton, Dialog, EmptyState, Numerals, Status, useFieldErrors, useStatusRegion, type Say } from "../ui.tsx";
import { OPEN_FILE_ERRORS } from "./Documents.tsx";

type Pending = DocumentRecord & { business_name: string };

const REVIEWED = "This document was already reviewed.";

export function Compliance(): ReactNode {
  const [documents, setDocuments] = useState<Pending[] | null>(null);
  const zone = useSites()[0]?.time_zone ?? "UTC";
  const [status, say] = useStatusRegion();
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ documents: Pending[] }>("/api/documents?status=pending");
    if (result.ok) setDocuments(result.data.documents);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async (d: Pending): Promise<void> => {
    say("Saving…");
    setVerifying(d.id);
    const result = await api<{ document: DocumentRecord; valid_through: string }>(`/api/documents/${d.id}/verify`, { method: "POST" });
    setVerifying(null);
    if (result.ok) say(`Verified. ${d.business_name} is covered through ${result.data.valid_through}.`);
    else
      say(
        errorCopy(result, { invalid_transition: REVIEWED, document_expired: "This document's expiry date has passed. Reject it instead." }),
        "error",
      );
    void load();
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Compliance</h1>
      <Status name="Compliance status" message={status} />
      <table role="table" aria-label="Documents awaiting review" className="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Member</th>
            <th role="columnheader" scope="col">Type</th>
            <th role="columnheader" scope="col">Expiry</th>
            <th role="columnheader" scope="col">Uploaded</th>
            <th role="columnheader" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(documents ?? []).map((d) => (
            <tr role="row" key={d.id}>
              <td role="cell" data-label="Member">{d.business_name}</td>
              <td role="cell" data-label="Type">{DOCUMENT_TYPE_LABELS[d.type]}</td>
              <td role="cell" data-label="Expiry" className="mono">{d.expiry_date}</td>
              <td role="cell" data-label="Uploaded" className="mono"><Numerals text={siteDateTime(d.created_at, zone)} /></td>
              <td role="cell" data-label="Actions">
                <div className="row-actions">
                <a
                  className="text-link"
                  href={`/api/documents/${d.id}/file`}
                  onClick={async (event) => {
                    event.preventDefault();
                    const result = await download(`/api/documents/${d.id}/file`);
                    if (!result.ok) say(errorCopy(result, OPEN_FILE_ERRORS), "error");
                  }}
                >
                  Open file
                </a>
                <ActionButton pending={verifying === d.id} className="button button-small button-confirm" onPress={() => void verify(d)}>
                  Verify
                </ActionButton>
                <button type="button" className="button button-small" onClick={() => setRejecting(d)}>
                  Reject
                </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {documents?.length === 0 && <EmptyState drawing="clipboard">Nothing is waiting for review.</EmptyState>}
      {rejecting && (
        <RejectDialog
          document={rejecting}
          onClose={() => setRejecting(null)}
          say={say}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}

function RejectDialog({
  document,
  onClose,
  say,
  onDone,
}: {
  document: Pending;
  onClose: () => void;
  say: Say;
  onDone: () => void;
}): ReactNode {
  const [reason, setReason] = useState("");
  const errors = useFieldErrors();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Reject document" onClose={onClose}>
      {(close) => (
        <>
          <p className="dialog-text">
            {DOCUMENT_TYPE_LABELS[document.type]} from {document.business_name}
          </p>
          <div className="field">
            <label htmlFor="reject-reason">Reason</label>
            <textarea
              id="reject-reason"
              rows={3}
              data-autofocus
              value={reason}
              {...errors.attrs("reason")}
              onChange={(e) => {
                setReason(e.target.value);
                errors.clear("reason");
              }}
            />
            {errors.node("reason")}
          </div>
          <div className="dialog-actions">
            <ActionButton
              pending={busy}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                errors.clearAll();
                say("Saving…");
                const result = await api<{ document: DocumentRecord }>(`/api/documents/${document.id}/reject`, { method: "POST", body: { reason } });
                setBusy(false);
                if (result.ok) {
                  say(`Rejected ${DOCUMENT_TYPE_LABELS[document.type]} for ${document.business_name}.`);
                  onDone();
                  close();
                  return;
                }
                if (result.error?.code === "validation") {
                  errors.set("reason", "Give a reason the member can act on.");
                  say("Give a reason the member can act on.", "error");
                  return;
                }
                say(errorCopy(result, { invalid_transition: REVIEWED }), "error");
                if (result.error?.code === "invalid_transition") onDone();
              }}
            >
              Reject document
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
