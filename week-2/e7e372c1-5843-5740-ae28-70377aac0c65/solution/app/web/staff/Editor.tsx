import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { request, sha256Hex, uploadPdf, type Outcome } from "../api.ts";
import {
  CLEARED, DRAFT_SAVED, HASH_MISMATCH, NOT_A_PDF, NOT_FILING_SAFE, NO_ACCESSION, RETURNED, SEND_REFUSED, SENT, SESSION_ENDED_CANCELLED,
  TOO_LARGE, UNEXPECTED, UPLOADING, VAULT_UPLOAD, VERSION_CONFLICT, WITHDRAWN, WITHDRAW_REFUSED,
} from "../copy.ts";
import { ReleaseDialog, SignInDialog, WithdrawDialog, type DialogSession } from "./Dialogs.tsx";
import { useSessionDialogs, type SessionDialogs } from "./Modal.tsx";
import { useStaff } from "./session.ts";
import { offered, type Facts } from "../../shared/restatementRules.ts";
import {
  eachRow, ROW_KEYS, ROW_LABELS, SHARE_EVENT_KINDS, SHARE_EVENT_LABELS,
  type AuditEntryView, type RestatementView, type RowKey, type ShareEventKind, type StaffUser,
} from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

interface EventRow {
  key: number;
  kind: ShareEventKind;
  shares: string;
  effective_date: string;
}

interface Form {
  reason: string;
  rows: Record<RowKey, string>;
  events: EventRow[];
  accession: string;
  page: string;
}

type ActionKind = "save" | "send" | "clear";

/** A request exactly as it was sent, kept so it can be resent once after a sign-in. */
interface Sent {
  kind: ActionKind;
  method: string;
  path: string;
  body: string;
}

interface Interrupted {
  sent: Sent;
  userId: string;
}

let eventKeys = 0;

function formOf(restatement: RestatementView): Form {
  return {
    reason: restatement.correction_reason ?? "",
    rows: eachRow((key) => restatement.rows[key] ?? ""),
    events: restatement.share_events.map((event) => ({ key: (eventKeys += 1), kind: event.kind, shares: event.shares, effective_date: event.effective_date })),
    accession: restatement.accession ?? "",
    page: restatement.exhibit_page === null ? "" : String(restatement.exhibit_page),
  };
}

function factsOfView(restatement: RestatementView): Facts {
  return {
    state: restatement.state,
    version: restatement.version,
    preparedBy: restatement.prepared_by.id,
    clearedBy: restatement.cleared_by?.id ?? null,
    releaseAt: restatement.release_at === null ? null : Date.parse(restatement.release_at),
  };
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

function saveBody(form: Form, version: number, correction: boolean): string {
  const page = form.page === "" ? null : Number.isInteger(Number(form.page)) ? Number(form.page) : form.page;
  const body: Record<string, unknown> = {
    version,
    rows: Object.fromEntries(ROW_KEYS.map((key) => [key, blankToNull(form.rows[key])])),
    share_events: form.events.map((event) => ({ kind: event.kind, shares: event.shares, effective_date: event.effective_date })),
    accession: blankToNull(form.accession),
    exhibit_page: page,
  };
  if (correction) body["correction_reason"] = blankToNull(form.reason);
  return JSON.stringify(body);
}

function fieldId(name: string): string {
  return `field-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function fieldTitle(name: string): string {
  const row = ROW_KEYS.find((key) => `rows.${key}` === name);
  if (row) return ROW_LABELS[row];
  const event = /^share_events\.(\d+)\.(.+)$/.exec(name);
  if (event) return `Share-count event ${Number(event[1]) + 1}, ${event[2]?.replace("_", " ")}`;
  const titles: Record<string, string> = { accession: "Accession number", exhibit_page: "Exhibit page", correction_reason: "Correction reason", note: "Return note", checked: "Review checklist", share_events: "Share-count events", rows: "Exhibit rows" };
  return titles[name] ?? name;
}

function exhibitState(restatement: RestatementView, pending: boolean): string {
  if (pending) return "Exhibit pending verification";
  if (restatement.exhibit?.status === "verified") return "Exhibit verified";
  if (restatement.exhibit?.status === "rejected") return "Exhibit rejected — SHA-256 mismatch";
  return "No exhibit attached";
}

function wallTime(instant: string): string {
  return `${isoWallDate(instant)} ${isoWallClock(instant, true)}`;
}

function dialogSession(dialogs: SessionDialogs, id: number, closing: boolean): DialogSession {
  return { id, closing, isActive: () => dialogs.isActive(id), cancel: () => dialogs.close(id), gone: () => dialogs.remove(id) };
}

export function Editor({ id }: { id: string }) {
  const staff = useStaff();
  const { user } = staff;
  const [restatement, setRestatement] = useState<RestatementView | null>(null);
  const [audit, setAudit] = useState<AuditEntryView[]>([]);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [updates, setUpdates] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [inflight, setInflight] = useState(0);
  const [checked, setChecked] = useState<Record<RowKey, boolean>>({ "beginning-balance": false, "eth-acquired": false, "staking-rewards": false, "ending-balance": false, "cumulative-staking-rewards": false, "diluted-shares": false });
  const [returnNote, setReturnNote] = useState("");
  const version = useRef(0);
  const uploadsInFlight = useRef(0);
  const interrupted = useRef<Interrupted | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const alertBox = useRef<HTMLDivElement | null>(null);
  const releaseDialogs = useSessionDialogs();
  const withdrawDialogs = useSessionDialogs();
  const signInDialogs = useSessionDialogs();

  const accept = useCallback((next: RestatementView) => {
    if (next.version < version.current) return;
    version.current = next.version;
    setRestatement(next);
  }, []);

  const loadAudit = useCallback(async () => {
    const answer = await request<{ entries: AuditEntryView[] }>("GET", `/api/restatements/${id}/audit`);
    if (answer.kind === "ok") setAudit(answer.body.entries);
  }, [id]);

  const reread = useCallback(async () => {
    const answer = await request<{ restatement: RestatementView }>("GET", `/api/restatements/${id}`);
    if (answer.kind === "ok") accept(answer.body.restatement);
    await loadAudit();
  }, [id, accept, loadAudit]);

  useEffect(() => {
    void request<{ restatement: RestatementView }>("GET", `/api/restatements/${id}`).then(async (answer) => {
      if (answer.kind !== "ok") {
        setMissing(true);
        return;
      }
      accept(answer.body.restatement);
      setForm(formOf(answer.body.restatement));
      await loadAudit();
    });
  }, [id, accept, loadAudit]);

  if (missing) return <p>This restatement could not be found.</p>;
  if (!restatement || !form) return <p>Loading restatement…</p>;

  const correction = restatement.supersedes !== null;
  const facts = factsOfView(restatement);
  const editable = offered("edit", facts, user);
  const reviewing = offered("clear", facts, user);
  const canRelease = offered("release", facts, user);
  const canWithdraw = offered("withdraw", facts, user);
  const pending = inflight > 0;

  const patchForm = (change: Partial<Form>): void => setForm((current) => (current ? { ...current, ...change } : current));
  const patchEvent = (key: number, change: Partial<EventRow>): void =>
    setForm((current) => (current ? { ...current, events: current.events.map((event) => (event.key === key ? { ...event, ...change } : event)) } : current));

  const showFieldErrors = (fields: Record<string, string>): void => {
    setErrors(fields);
    setUpdates("");
    window.setTimeout(() => alertBox.current?.focus(), 0);
  };

  const finish = (kind: ActionKind | "return", answer: Awaited<ReturnType<typeof request<{ restatement: RestatementView }>>>): void => {
    if (answer.kind === "ok") {
      accept(answer.body.restatement);
      setErrors({});
      setUpdates({ save: DRAFT_SAVED, send: SENT, clear: CLEARED, return: RETURNED }[kind]);
      void loadAudit();
    } else if (answer.kind === "refused" && answer.code === "validation_failed") {
      showFieldErrors(answer.fields);
    } else if (answer.kind === "refused" && answer.code === "version_conflict") {
      setUpdates(VERSION_CONFLICT);
    } else if (answer.kind === "refused" && answer.code === "exhibit_not_verified") {
      setUpdates(SEND_REFUSED);
    } else {
      setUpdates(UNEXPECTED);
    }
  };

  const perform = async (sent: Sent, opener: HTMLElement | null): Promise<void> => {
    const answer = await request<{ restatement: RestatementView }>(sent.method, sent.path, { rawBody: sent.body });
    if (answer.kind === "refused" && answer.status === 401) {
      interrupted.current = { sent, userId: user.id };
      signInDialogs.open(opener);
      return;
    }
    finish(sent.kind, answer);
  };

  const save = (event: React.MouseEvent<HTMLButtonElement>): void => {
    void perform({ kind: "save", method: "PATCH", path: `/api/restatements/${id}`, body: saveBody(form, version.current, correction) }, event.currentTarget);
  };
  const send = (event: React.MouseEvent<HTMLButtonElement>): void => {
    void perform({ kind: "send", method: "POST", path: `/api/restatements/${id}/submit`, body: "{}" }, event.currentTarget);
  };
  const clear = (event: React.MouseEvent<HTMLButtonElement>): void => {
    void perform({ kind: "clear", method: "POST", path: `/api/restatements/${id}/clear`, body: JSON.stringify({ checked: ROW_KEYS, version: version.current }) }, event.currentTarget);
  };

  const sendBack = async (): Promise<void> => {
    const answer = await request<{ restatement: RestatementView }>("POST", `/api/restatements/${id}/return`, { body: { note: returnNote } });
    if (answer.kind === "refused" && answer.status === 401) setUpdates(SESSION_ENDED_CANCELLED);
    else finish("return", answer);
  };

  const signedIn = (next: StaffUser, stillOpen: boolean, dialogId: number): void => {
    if (!stillOpen) return;
    signInDialogs.close(dialogId);
    const pendingAction = interrupted.current;
    interrupted.current = null;
    if (pendingAction && next.id === pendingAction.userId) {
      void perform(pendingAction.sent, null);
      return;
    }
    staff.setUser(next);
    setUpdates(`Signed in as ${next.name}. The interrupted action was not sent.`);
    void reread();
  };

  const cancelSignIn = (dialogId: number): void => {
    signInDialogs.close(dialogId);
    interrupted.current = null;
    setUpdates(SESSION_ENDED_CANCELLED);
  };

  const withdraw = async (note: string, dialogId: number): Promise<"http" | "network"> => {
    const answer = await request<{ restatement: RestatementView }>("POST", `/api/restatements/${id}/withdraw`, { body: { version: version.current, note } });
    const mine = withdrawDialogs.isActive(dialogId);
    if (answer.kind === "network") {
      setUpdates(UNEXPECTED);
      return "network";
    }
    setUpdates(answer.kind === "ok" ? WITHDRAWN : answer.code === "invalid_transition" || answer.code === "version_conflict" ? WITHDRAW_REFUSED : UNEXPECTED);
    if (mine) {
      withdrawDialogs.close(dialogId);
      window.setTimeout(() => heading.current?.focus(), 0);
    }
    void reread();
    return "http";
  };

  /** The outcome copy of one settled upload; its side effects on the editor happen here too. */
  const settleUpload = async (answer: Outcome<{ restatement: RestatementView }>, hash: string): Promise<string> => {
    if (answer.kind === "ok") {
      const stored = answer.body.restatement;
      accept(stored);
      void loadAudit();
      return `Exhibit verified — SHA-256 ${stored.exhibit?.sha256 ?? hash} matches the vault copy.`;
    }
    if (answer.kind === "network") return UNEXPECTED;
    if (answer.status === 401) {
      setUpdates(SESSION_ENDED_CANCELLED);
      return "";
    }
    if (answer.status === 422 && answer.fields["sha256"] && !answer.fields["file"] && !answer.fields["accession"]) {
      await reread();
      return HASH_MISMATCH;
    }
    if (answer.status === 413) return TOO_LARGE;
    if (answer.status === 503) return VAULT_UPLOAD;
    if (answer.fields["file"]) return answer.fields["file"] === "The exhibit is not a complete PDF." ? NOT_A_PDF : NOT_FILING_SAFE;
    if (answer.fields["accession"]) return NO_ACCESSION;
    return UNEXPECTED;
  };

  // Several uploads may be in flight at once (a double drop); the progress copy stays until the
  // last of them is answered, and the live region then announces that one's outcome.
  const startUpload = async (file: File): Promise<void> => {
    uploadsInFlight.current += 1;
    setInflight((count) => count + 1);
    setUploadStatus(UPLOADING);
    const hash = await sha256Hex(file);
    const copy = await settleUpload(await uploadPdf<{ restatement: RestatementView }>(`/api/restatements/${id}/exhibit`, file, hash), hash);
    uploadsInFlight.current -= 1;
    if (uploadsInFlight.current === 0) setUploadStatus(copy);
    setInflight((count) => count - 1);
  };

  const chosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of files) void startUpload(file);
  };

  const dropped = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!editable) return;
    for (const file of Array.from(event.dataTransfer.files)) void startUpload(file);
  };

  const focusField = (name: string): void => document.getElementById(fieldId(name))?.focus();
  const invalid = (name: string): string | undefined => errors[name];
  const errorNames = Object.keys(errors);

  const textField = (name: string, label: string, value: string, change: (value: string) => void, options: { readOnly?: boolean; type?: string } = {}) => (
    <div className={invalid(name) ? "field invalid" : "field"}>
      <label htmlFor={fieldId(name)}>{label}</label>
      <input id={fieldId(name)} type={options.type ?? "text"} value={value} readOnly={options.readOnly ?? !editable} inputMode={options.type === "number" ? "numeric" : undefined} aria-invalid={invalid(name) ? true : undefined} onChange={(event) => change(event.target.value)} />
    </div>
  );

  return (
    <>
      <h1 tabIndex={-1} ref={heading}>Week ending {restatement.week_ending}</h1>
      {correction && restatement.correction_reason && <p className="muted">Correction: {restatement.correction_reason}</p>}
      <p className="muted">
        State: {restatement.state} · version {restatement.version} · prepared by {restatement.prepared_by.name}
      </p>
      <p className="staff-updates" role="status" aria-label="Staff updates">{updates}</p>
      {errorNames.length > 0 && (
        <div className="alert" role="alert" aria-label="There is a problem with this draft" tabIndex={-1} ref={alertBox}>
          <h2>There is a problem with this draft</h2>
          <ul>
            {errorNames.map((name) => (
              <li key={name}>
                <a href={`#${fieldId(name)}`} onClick={(event) => { event.preventDefault(); focusField(name); }}>
                  {fieldTitle(name)}: {errors[name]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {restatement.state === "returned" && restatement.return_note && <p className="marker">Returned by counsel: {restatement.return_note}</p>}

      <div className="form-grid section">
        {textField("week_ending", "Week ending", restatement.week_ending, () => undefined, { readOnly: true })}
        {correction && textField("correction_reason", "Correction reason", form.reason, (value) => patchForm({ reason: value }))}
        {ROW_KEYS.map((key) => textField(`rows.${key}`, ROW_LABELS[key], form.rows[key], (value) => patchForm({ rows: { ...form.rows, [key]: value } })))}
      </div>

      <section className="section" aria-label="Share-count events">
        <h2>Share-count events</h2>
        {form.events.length === 0 && <div className="blank-page" style={{ minHeight: 64, margin: "0 0 16px" }}><span className="muted">No share-count events on this draft.</span></div>}
        <ul className="events">
          {form.events.map((event, index) => (
            <li className="event" key={event.key}>
              <div className="field">
                <label htmlFor={`event-kind-${event.key}`}>Event type</label>
                <select id={`event-kind-${event.key}`} value={event.kind} disabled={!editable} onChange={(change) => patchEvent(event.key, { kind: SHARE_EVENT_KINDS.find((kind) => kind === change.target.value) ?? event.kind })}>
                  {SHARE_EVENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{SHARE_EVENT_LABELS[kind]}</option>
                  ))}
                </select>
              </div>
              <div className={invalid(`share_events.${index}.shares`) ? "field invalid" : "field"}>
                <label htmlFor={fieldId(`share_events.${index}.shares`)}>Shares</label>
                <input id={fieldId(`share_events.${index}.shares`)} type="text" inputMode="numeric" value={event.shares} readOnly={!editable} onChange={(change) => patchEvent(event.key, { shares: change.target.value })} />
              </div>
              <div className={invalid(`share_events.${index}.effective_date`) ? "field invalid" : "field"}>
                <label htmlFor={fieldId(`share_events.${index}.effective_date`)}>Effective date</label>
                <input id={fieldId(`share_events.${index}.effective_date`)} type="text" placeholder="YYYY-MM-DD" value={event.effective_date} readOnly={!editable} onChange={(change) => patchEvent(event.key, { effective_date: change.target.value })} />
              </div>
              {editable && <button type="button" onClick={() => patchForm({ events: form.events.filter((candidate) => candidate.key !== event.key) })}>Remove event</button>}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="actions">
            <button type="button" onClick={() => patchForm({ events: [...form.events, { key: (eventKeys += 1), kind: "atm_settlement", shares: "", effective_date: "" }] })}>Add share-count event</button>
          </div>
        )}
      </section>

      <div className="form-grid section">
        {textField("accession", "Accession number", form.accession, (value) => patchForm({ accession: value }))}
        <div className={invalid("exhibit_page") ? "field invalid" : "field"}>
          <label htmlFor={fieldId("exhibit_page")}>Exhibit page</label>
          <input id={fieldId("exhibit_page")} type="number" min={1} max={500} value={form.page} readOnly={!editable} onChange={(event) => patchForm({ page: event.target.value })} />
        </div>
      </div>

      <section className="section" aria-label="Exhibit">
        <h2>Exhibit</h2>
        <div className="exhibit-box" onDragOver={(event) => event.preventDefault()} onDrop={dropped}>
          <p className="exhibit-state">{exhibitState(restatement, pending)}</p>
          {restatement.exhibit?.status === "verified" && !pending && <p className="muted mono">SHA-256 {restatement.exhibit.sha256}</p>}
          {editable && (
            <div className="field">
              <label htmlFor="exhibit-file">Exhibit PDF</label>
              <input id="exhibit-file" type="file" accept="application/pdf" onChange={chosen} />
            </div>
          )}
          <p className="upload-status" role="status" aria-label="Exhibit upload">{uploadStatus}</p>
        </div>
      </section>

      {editable && (
        <div className="actions">
          <button type="button" className="primary" onClick={save}>Save draft</button>
          <button type="button" disabled={pending} onClick={send}>Send to disclosure counsel</button>
        </div>
      )}

      {reviewing && (
        <section className="section" aria-label="Counsel review">
          <h2>Counsel review</h2>
          <ul className="checklist">
            {ROW_KEYS.map((key) => (
              <li className="check" key={key}>
                <input id={`check-${key}`} type="checkbox" checked={checked[key]} onChange={(event) => setChecked({ ...checked, [key]: event.target.checked })} />
                <label htmlFor={`check-${key}`}>Matches exhibit: {ROW_LABELS[key]}</label>
              </li>
            ))}
          </ul>
          <div className={invalid("note") ? "field invalid" : "field"} style={{ marginTop: 16 }}>
            <label htmlFor={fieldId("note")}>Return note</label>
            <textarea id={fieldId("note")} value={returnNote} onChange={(event) => setReturnNote(event.target.value)} />
          </div>
          <div className="actions">
            <button type="button" onClick={() => void sendBack()}>Return to analyst</button>
            <button type="button" className="primary" disabled={!ROW_KEYS.every((key) => checked[key])} onClick={clear}>Clear for release</button>
          </div>
        </section>
      )}

      {canRelease && (
        <div className="actions">
          <button type="button" className="primary" onClick={(event) => releaseDialogs.open(event.currentTarget)}>Release restatement</button>
        </div>
      )}
      {canWithdraw && (
        <div className="actions">
          <button type="button" onClick={(event) => withdrawDialogs.open(event.currentTarget)}>Withdraw release</button>
        </div>
      )}

      <section className="section" aria-label="Audit">
        <h2>Audit trail</h2>
        <div className="table-scroll">
          <table className="list audit" aria-label="Audit trail">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Action</th>
                <th scope="col">By</th>
                <th scope="col">At (ET)</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.version}>
                  <td className="mono">{entry.version}</td>
                  <td>{entry.action}</td>
                  <td>{entry.actor?.name ?? "Tracewell"}</td>
                  <td className="mono">{wallTime(entry.at)}</td>
                  <td>{entry.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {releaseDialogs.instances.map((instance) => (
        <ReleaseDialog
          key={instance.id}
          session={dialogSession(releaseDialogs, instance.id, instance.closing)}
          restatement={restatement}
          onOutcome={(copy, delivered) => {
            if (!delivered) setUpdates(copy);
            void reread();
          }}
        />
      ))}
      {withdrawDialogs.instances.map((instance) => (
        <WithdrawDialog key={instance.id} session={dialogSession(withdrawDialogs, instance.id, instance.closing)} restatement={restatement} onWithdraw={(note) => withdraw(note, instance.id)} />
      ))}
      {signInDialogs.instances.map((instance) => {
        const session = dialogSession(signInDialogs, instance.id, instance.closing);
        return <SignInDialog key={instance.id} session={{ ...session, cancel: () => cancelSignIn(instance.id) }} onSignedIn={(next, stillOpen) => signedIn(next, stillOpen, instance.id)} />;
      })}
    </>
  );
}
