import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { evidenceDownNow } from "../app-state.ts";
import { firstMessage, focusFirstInvalid, TextField } from "../forms.tsx";
import { afterRender, api, ApiFailure, enc, newKey, type Tag } from "../lib.ts";
import { focusEl, Overlay } from "../ui.tsx";
import type { AssetDetail, ColumnRead } from "./types.ts";

export interface DeprecateReply {
  asset: AssetDetail;
  notices_queued: number;
  queued_notices: number;
}

export interface ReinstateReply {
  asset: AssetDetail;
  notices_cancelled: number;
  queued_notices: number;
}

interface Base {
  open: boolean;
  onCancel(): void;
}

function failureOf(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", "Something went wrong. Try again.");
}

/** Replies are applied only while the dialog's opening is still open. */
function useOpening(open: boolean) {
  const alive = useRef(open);
  useLayoutEffect(() => {
    alive.current = open;
  }, [open]);
  return alive;
}

export function VerifyDialog(props: Base & { assetId: string; onVerified(detail: AssetDetail): void }) {
  const [key] = useState(newKey);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const alive = useOpening(props.open);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setStatus("Uploading evidence...");
    const form = new FormData();
    const chosen = file.current?.files?.[0];
    if (chosen) form.append("evidence", chosen, chosen.name);
    else form.append("evidence", new Blob([]), "");
    form.append("note", note);
    try {
      const detail = await api<AssetDetail>("POST", `/api/assets/${enc(props.assetId)}/verify`, form, { "Idempotency-Key": key });
      if (!alive.current) return;
      setPending(false);
      setErrors({});
      setStatus(`Verified. Evidence stored as ${detail.evidence!.filename}.`);
      props.onVerified(detail);
    } catch (error) {
      if (!alive.current) return;
      const f = failureOf(error);
      setPending(false);
      if (f.status === 503) evidenceDownNow();
      if (f.status === 422) {
        setErrors(f.fields);
        setStatus(firstMessage(f.fields, ["evidence", "note"]) ?? f.message);
        await focusFirstInvalid(f.fields, [["evidence", "verify-file"], ["note", "verify-note"]]);
      } else {
        setStatus(f.message);
        await afterRender();
        focusEl(document.getElementById("verify-submit"));
      }
    }
  };

  return (
    <Overlay open={props.open} kind="dialog" label="Verify asset" onEscape={props.onCancel} initialFocus={() => document.getElementById("verify-file")}>
      {pending && <div class="upload-progress" data-upload-progress=""><span /></div>}
      <h2 class="dialog-title">Verify asset</h2>
      <p class="dialog-lede mono wrap">{props.assetId}</p>
      <form class="dialog-form" onSubmit={(e) => (e.preventDefault(), void submit())} noValidate>
        <div class="field">
          <label for="verify-file" class="field-label">Evidence file</label>
          <input id="verify-file" type="file" ref={file} accept=".pdf,.txt"
            aria-invalid={errors.evidence ? "true" : undefined} aria-describedby={errors.evidence ? "verify-file-error" : undefined} />
          <p id="verify-file-error" class="field-error">{errors.evidence ?? ""}</p>
        </div>
        <TextField id="verify-note" label="Note" value={note} error={errors.note} multiline onInput={setNote} />
        <div class="dialog-actions">
          <button id="verify-submit" type="submit" class="btn btn-ink">Verify asset</button>
          <button type="button" class="btn btn-quiet" onClick={props.onCancel}>Cancel</button>
        </div>
        <div role="status" aria-label="Dialog status" class="dialog-status">{status}</div>
      </form>
    </Overlay>
  );
}

export function DeprecateDialog(props: Base & { assetId: string; onDeprecated(reply: DeprecateReply): void }) {
  const [key] = useState(newKey);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const alive = useOpening(props.open);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setStatus("Saving...");
    try {
      const reply = await api<DeprecateReply>("POST", `/api/assets/${enc(props.assetId)}/deprecate`, { reason }, { "Idempotency-Key": key });
      if (!alive.current) return;
      setPending(false);
      setStatus(`Deprecated. Downstream owner notices queued: ${reply.notices_queued}.`);
      props.onDeprecated(reply);
    } catch (error) {
      if (!alive.current) return;
      const f = failureOf(error);
      setPending(false);
      setErrors(f.status === 422 ? f.fields : {});
      setStatus(f.status === 422 ? firstMessage(f.fields, ["reason"]) ?? f.message : f.message);
      if (f.status === 422) await focusFirstInvalid(f.fields, [["reason", "deprecate-reason"]]);
    }
  };

  return (
    <Overlay open={props.open} kind="dialog" label="Deprecate asset" onEscape={props.onCancel} initialFocus={() => document.getElementById("deprecate-reason")}>
      <h2 class="dialog-title">Deprecate asset</h2>
      <p class="dialog-lede mono wrap">{props.assetId}</p>
      <form class="dialog-form" onSubmit={(e) => (e.preventDefault(), void submit())} noValidate>
        <TextField id="deprecate-reason" label="Reason" value={reason} error={errors.reason} multiline onInput={setReason} />
        <div class="dialog-actions">
          <button type="submit" class="btn btn-ink">Deprecate asset</button>
          <button type="button" class="btn btn-quiet" onClick={props.onCancel}>Cancel</button>
        </div>
        <div role="status" aria-label="Dialog status" class="dialog-status">{status}</div>
      </form>
    </Overlay>
  );
}

export function ReinstateDialog(props: Base & { assetId: string; onReinstated(reply: ReinstateReply): void }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const alive = useOpening(props.open);
  const submit = async () => {
    if (pending) return;
    setPending(true);
    setStatus("Saving...");
    try {
      const reply = await api<ReinstateReply>("POST", `/api/assets/${enc(props.assetId)}/reinstate`, {});
      if (!alive.current) return;
      setPending(false);
      setStatus(`Reinstated to draft. Unsent notices cancelled: ${reply.notices_cancelled}.`);
      props.onReinstated(reply);
    } catch (error) {
      if (!alive.current) return;
      setPending(false);
      setStatus(failureOf(error).message);
    }
  };
  return (
    <Overlay open={props.open} kind="dialog" label="Reinstate asset" onEscape={props.onCancel} initialFocus={() => document.getElementById("reinstate-submit")}>
      <h2 class="dialog-title">Reinstate asset</h2>
      <p class="dialog-lede">
        <span class="mono wrap">{props.assetId}</span> returns to draft. Its unsent deprecation notices are cancelled.
      </p>
      <div class="dialog-actions">
        <button id="reinstate-submit" type="button" class="btn btn-ink" onClick={() => void submit()}>Reinstate asset</button>
        <button type="button" class="btn btn-quiet" onClick={props.onCancel}>Cancel</button>
      </div>
      <div role="status" aria-label="Dialog status" class="dialog-status">{status}</div>
    </Overlay>
  );
}

export function SuppressDialog(props: Base & {
  columnId: string;
  tag: Tag;
  onSuppressed(column: ColumnRead): void;
  onRefused(message: string): void;
}) {
  const [justification, setJustification] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const alive = useOpening(props.open);
  const submit = async () => {
    if (pending) return;
    setPending(true);
    setStatus("Saving...");
    try {
      const reply = await api<{ column: ColumnRead }>("POST", `/api/columns/${enc(props.columnId)}/suppressions`, { tag: props.tag, justification });
      if (!alive.current) return;
      setPending(false);
      setStatus(`${props.tag} suppressed on ${props.columnId}.`);
      props.onSuppressed(reply.column);
    } catch (error) {
      if (!alive.current) return;
      const f = failureOf(error);
      setPending(false);
      setErrors(f.status === 422 ? f.fields : {});
      setStatus(f.status === 422 ? firstMessage(f.fields, ["justification"]) ?? f.message : f.message);
      if (f.status === 422) await focusFirstInvalid(f.fields, [["justification", "suppress-justification"]]);
      if (f.status === 409) props.onRefused(f.message);
    }
  };
  return (
    <Overlay open={props.open} kind="dialog" label="Suppress tag" onEscape={props.onCancel} initialFocus={() => document.getElementById("suppress-justification")}>
      <h2 class="dialog-title">Suppress tag</h2>
      <p class="dialog-lede">
        {`${props.tag} on `}<span class="mono wrap">{props.columnId}</span>
      </p>
      <form class="dialog-form" onSubmit={(e) => (e.preventDefault(), void submit())} noValidate>
        <TextField id="suppress-justification" label="Justification" value={justification} error={errors.justification} multiline onInput={setJustification} />
        <div class="dialog-actions">
          <button type="submit" class="btn btn-ink">Suppress tag</button>
          <button type="button" class="btn btn-quiet" onClick={props.onCancel}>Cancel</button>
        </div>
        <div role="status" aria-label="Dialog status" class="dialog-status">{status}</div>
      </form>
    </Overlay>
  );
}
