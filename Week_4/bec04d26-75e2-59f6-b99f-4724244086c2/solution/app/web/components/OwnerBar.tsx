import { type FormEvent, useRef, useState } from "react";
import { type FieldErrors, type ReturnView, STATUS_LABELS } from "../../shared/types";
import { announce, PRIORITY } from "../announce";
import { type Failure, request } from "../api";
import { conflictLine, SERVER_ERROR } from "../copy";
import { noteOwn } from "../live";
import { Dialog, useDialogClose } from "./Dialog";
import { TextField, useFirstMessage } from "./Fields";

function SendBack({ view, onSent }: { view: ReturnView; onSent?: (view: ReturnView) => void }) {
  const close = useDialogClose();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, true);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<ReturnView>("POST", `/api/returns/${view.id}/send-back`, { version: view.version, reason });
    if (answer.ok) {
      noteOwn(answer.data);
      onSent?.(answer.data);
      close();
    } else if (answer.failure.kind === "fields") setErrors({ ...answer.failure.errors });
    else announceFailure(answer.failure);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <TextField label="Reason" multiline value={reason} onChange={setReason} error={errors?.reason} />
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Send back"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

/** A stale version is the conflict line; anything else the unexpected-error line. */
function announceFailure(failure: Failure): void {
  if (failure.kind === "conflict") announce(conflictLine(failure.body.changed_by, STATUS_LABELS[failure.body.return.status]), PRIORITY.conflict);
  else announce(SERVER_ERROR, PRIORITY.fieldError);
}

interface OwnerBarProps {
  view: ReturnView;
  /** The newest answer for the return, so a screen can show it before the live echo arrives. */
  onChanged?: (view: ReturnView) => void;
  fallbackFocus?: () => void;
}

/** The owner's two actions: Approve, and Send back through the bottom sheet. Pinned to the bottom on phones. */
export function OwnerBar({ view, onChanged, fallbackFocus }: OwnerBarProps) {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = `${view.state} ${view.period_label}`;

  const approve = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const answer = await request<ReturnView>("POST", `/api/returns/${view.id}/approve`, { version: view.version });
    if (answer.ok) {
      noteOwn(answer.data);
      onChanged?.(answer.data);
    } else announceFailure(answer.failure);
    setBusy(false);
  };

  if (!view.allowed.includes("send_back")) return null;
  return (
    <>
      <div className="owner-bar">
        <button type="button" className="button send-back" aria-label={`Send back ${name}`} onClick={() => setSheet(true)}>Send back</button>
        {view.allowed.includes("approve") && (
          <button type="button" className="button primary approve" aria-label={`Approve ${name}`} aria-disabled={busy} onClick={approve}>
            Approve
          </button>
        )}
      </div>
      {sheet && (
        <Dialog title="Send back" sheet onClose={() => setSheet(false)} fallbackFocus={fallbackFocus}>
          <SendBack view={view} onSent={onChanged} />
        </Dialog>
      )}
    </>
  );
}
