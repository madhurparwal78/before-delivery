import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatTime, type Currency } from "../../../../shared/format";
import { patch, post, type ErrorBody, type Result } from "../../api";
import { isStudio, useOffice } from "../context";
import { otherIllegal } from "../copy";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { ErrorSummary, TextField, type Errors } from "../fields";
import { ActionButton, domId, focusId, StickyBar } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import "./stages.css";

interface MemberRef {
  id: string;
  name: string;
}

interface Stage {
  key: string;
  name: string;
  feeCents: number | null;
  currency: Currency;
  state: "not_started" | "requested" | "signed_off" | "returned";
  requestedAt: string | null;
  requestedBy: MemberRef | null;
  signedOffAt: string | null;
  signedOffBy: MemberRef | null;
  returnedReason: string | null;
  invoice: { invoiceNumber: string } | null;
  internalNote?: string;
  /** What the signed-in member can do with this stage now, decided by the server. */
  actions: string[];
}

const STATE_TEXT: Record<Stage["state"], string> = {
  not_started: "Not started", requested: "Requested", signed_off: "Signed off", returned: "Returned",
};
const BILLING_OUTAGE = (stage: string): string =>
  `Billing is unreachable, so ${stage} wasn't signed off. Nothing was recorded; try again in a few minutes.`;

type DialogKind = "request" | "sign-off" | "return" | null;
const headingId = (key: string): string => domId("stage", key);

export function StagesPanel() {
  const office = useOffice();
  const { project } = useProject();
  const resource = useResource<{ stages: Stage[]; currentStage: string }>(`/api/projects/${project.id}/stages`);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [dialogError, setDialogError] = useState("");
  const restored = useRef(false);

  const stages = resource.data?.stages ?? [];
  const current = stages.find((stage) => stage.key === resource.data?.currentStage);
  const can = (action: string): boolean => !!current?.actions.includes(action);
  const canRequest = can("request");
  const canDecide = can("sign_off");

  useEffect(() => {
    if (current) setNote(current.internalNote ?? "");
  }, [current?.key, current?.internalNote]);

  // A draft kept when the session ended mid-form comes back with its dialog open.
  useEffect(() => {
    if (!current || restored.current) return;
    restored.current = true;
    for (const [form, kind] of [["request-sign-off", "request"], ["return-stage", "return"], ["internal-note", null]] as const) {
      const values = office.takeDraft(form);
      if (!values) continue;
      if (kind === "request") setMessage(String(values.message ?? ""));
      if (kind === "return") setReason(String(values.reason ?? ""));
      if (kind === null) setNote(String(values.internalNote ?? ""));
      if (kind) setDialog(kind);
    }
  }, [current, office]);

  const open = (kind: DialogKind): void => {
    setErrors({});
    setDialogError("");
    if (kind === "request") setMessage("");
    if (kind === "return") setReason("");
    setDialog(kind);
  };

  const done = async (stage: Stage, success: string | null, problem: string | null): Promise<void> => {
    flushSync(() => setDialog(null));
    await resource.reload();
    if (success) office.announce(success);
    if (problem) office.alert(problem);
    focusId(headingId(stage.key));
  };

  const refusal = (stage: Stage, body: ErrorBody): void => {
    if (body.errors) {
      flushSync(() => setErrors(body.errors ?? {}));
    } else {
      const copy = otherIllegal(String(body.from ?? stage.state));
      office.alert(copy);
      flushSync(() => setDialogError(copy));
    }
    focusRefusal(openDialog());
  };

  const settle = async (result: Result<unknown>, stage: Stage, form: { id: string; values: Record<string, unknown> }, success: string): Promise<void> => {
    if (result.ok) return done(stage, success, null);
    office.announce("");
    const body = office.refused(result, form);
    if (body) refusal(stage, body);
  };

  const request = async (stage: Stage): Promise<void> => {
    office.announce("Requesting sign-off…");
    const result = await post(`/api/projects/${project.id}/stages/${stage.key}/request`, { message });
    await settle(result, stage, { id: "request-sign-off", values: { message } }, `Sign-off requested for ${stage.name}.`);
  };

  const signOff = async (stage: Stage): Promise<void> => {
    office.announce(`Signing off ${stage.name}…`);
    const result = await post<{ stage: Stage }>(`/api/projects/${project.id}/stages/${stage.key}/sign-off`, {});
    if (result.ok) {
      const invoice = result.data.stage.invoice?.invoiceNumber ?? "";
      return done(stage, `${stage.name} signed off. Invoice ${invoice} raised; a receipt is on its way to ${office.member?.email ?? ""}.`, null);
    }
    office.announce("");
    const body = office.refused(result);
    if (!body) return;
    if (body.error === "already_signed_off") {
      return done(stage, null, `${String(body.by)} already signed off ${stage.name} on ${formatTime(String(body.at))}.`);
    }
    if (body.error === "billing_unavailable") {
      const copy = BILLING_OUTAGE(stage.name);
      office.alert(copy);
      flushSync(() => setDialogError(copy));
      focusRefusal(openDialog());
      return;
    }
    refusal(stage, body);
  };

  const returnStage = async (stage: Stage): Promise<void> => {
    office.announce("Returning…");
    const result = await post(`/api/projects/${project.id}/stages/${stage.key}/return`, { reason });
    await settle(result, stage, { id: "return-stage", values: { reason } }, `${stage.name} returned to the studio.`);
  };

  const saveNote = async (stage: Stage): Promise<void> => {
    office.announce("Saving…");
    const result = await patch(`/api/projects/${project.id}/stages/${stage.key}`, { internalNote: note });
    if (result.ok) {
      await resource.reload();
      office.announce("Internal note saved.");
      return;
    }
    office.announce("");
    const body = office.refused(result, { id: "internal-note", values: { internalNote: note } });
    if (body?.errors) {
      flushSync(() => setErrors(body.errors ?? {}));
      document.querySelector<HTMLElement>(".stage-note .field-error")?.focus();
    }
  };

  const primary = current && (canRequest
    ? <button type="button" className="button button-primary" onClick={() => open("request")}>Request sign-off for {current.name}</button>
    : canDecide ? <button type="button" className="button button-primary" onClick={() => open("sign-off")}>Sign off {current.name}</button> : null);

  return (
    <div className={primary ? "has-action-bar" : undefined}>
      <PanelTitle section="stages" />
      <div className="panel-heading">
        <div>
          <h2>Stage gates</h2>
          <p className="stage-lede">Each fee-bearing stage is requested by the studio and signed off or returned by {project.brand.name}.</p>
        </div>
        {current && <p className="stage-current">Current stage <strong>{current.name}</strong></p>}
      </div>
      {!resource.data && <p className="panel-body">Loading stages…</p>}
      <ol className="stage-list">
        {stages.map((stage, index) => {
          const isCurrent = stage.key === current?.key;
          return (
            <li key={stage.key} className={`stage stage-${stage.state}${isCurrent ? " is-current" : ""}`}>
              <span className="stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className="stage-title">
                <h3 id={headingId(stage.key)} tabIndex={-1}>{stage.name}</h3>
                <p className="stage-state"><span className="stage-mark" aria-hidden="true" />{STATE_TEXT[stage.state]}</p>
              </div>
              <p className="stage-fee">{stage.feeCents === null ? "No fee" : formatAmount(stage.currency, stage.feeCents)}</p>
              <div className="stage-meta">
                {stage.requestedBy && stage.requestedAt && stage.state !== "signed_off" && (
                  <p>Requested by {stage.requestedBy.name}, <span className="stage-when">{formatTime(stage.requestedAt)}</span></p>
                )}
                {stage.signedOffBy && stage.signedOffAt && <p>Signed off by {stage.signedOffBy.name}, <span className="stage-when">{formatTime(stage.signedOffAt)}</span></p>}
                {stage.invoice && <p>Invoice {stage.invoice.invoiceNumber}</p>}
                {stage.state === "returned" && stage.returnedReason && <p>Returned: {stage.returnedReason}</p>}
                {isStudio(office.member) && !isCurrent && stage.internalNote && <p className="stage-note-text">Internal note: {stage.internalNote}</p>}
              </div>
              {isCurrent && (
                <div className="stage-actions">
                  {primary}
                  {can("return") && <button type="button" className="button" onClick={() => open("return")}>Return {stage.name}</button>}
                </div>
              )}
              {isCurrent && isStudio(office.member) && (
                can("note") ? (
                  <form className="stage-note" noValidate onSubmit={(event) => event.preventDefault()}>
                    <TextField form="internal-note" name="internalNote" label="Internal note" multiline value={note} onChange={setNote}
                      error={errors.internalNote} hint="Seen only by the studio." />
                    <ActionButton type="submit" pending="Saving…" onAction={() => saveNote(stage)}>Save note</ActionButton>
                  </form>
                ) : stage.internalNote ? <p className="stage-note stage-note-text">Internal note: {stage.internalNote}</p> : null
              )}
            </li>
          );
        })}
      </ol>
      {primary && <StickyBar>{primary}</StickyBar>}

      {current && (
        <>
          <Dialog title={`Request sign-off for ${current.name}`} open={dialog === "request"} onCancel={() => setDialog(null)} error={dialogError}
            actions={<ActionButton primary type="submit" pending="Requesting sign-off…" onAction={() => request(current)}>Send request</ActionButton>}>
            <ErrorSummary form="request-sign-off" errors={errors} />
            <TextField form="request-sign-off" name="message" label="Message to approvers" multiline value={message} onChange={setMessage} error={errors.message} />
          </Dialog>
          <Dialog title={`Sign off ${current.name}`} open={dialog === "sign-off"} onCancel={() => setDialog(null)} error={dialogError}
            actions={<ActionButton primary type="submit" pending={`Signing off ${current.name}…`} onAction={() => signOff(current)}>Confirm sign-off</ActionButton>}>
            <dl className="stage-confirm">
              <dt>Project</dt><dd>{project.reference} {project.name}</dd>
              <dt>Stage</dt><dd>{current.name}</dd>
              <dt>Fee</dt><dd>{current.feeCents === null ? "No fee" : formatAmount(current.currency, current.feeCents)}</dd>
            </dl>
            <p>Signing off raises the stage fee invoice and emails you a receipt.</p>
          </Dialog>
          <Dialog title={`Return ${current.name}`} open={dialog === "return"} onCancel={() => setDialog(null)} error={dialogError}
            actions={<ActionButton primary type="submit" pending="Returning…" onAction={() => returnStage(current)}>Return to studio</ActionButton>}>
            <ErrorSummary form="return-stage" errors={errors} />
            <TextField form="return-stage" name="reason" label="Reason" multiline value={reason} onChange={setReason} error={errors.reason} />
          </Dialog>
        </>
      )}
    </div>
  );
}
