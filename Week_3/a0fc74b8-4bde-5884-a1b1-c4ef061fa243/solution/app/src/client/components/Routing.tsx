import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { type FormEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { GENERIC_FAILURE, rowWord } from "../../shared/copy";
import type { DocumentJson, RecipientJson } from "../../shared/types";
import { ApiFailure, api } from "../lib/api";
import type { Track } from "../lib/useDocument";
import { zonedMinute } from "../lib/format";
import { Link } from "../lib/router";
import { Dialog } from "./Dialog";
import { Status } from "./Regions";

const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
const VOID_LIMIT = 500;

interface RoutingProps {
  doc: DocumentJson;
  canManage: boolean;
  isOwnerRole: boolean;
  updates: string;
  announce: (text: string) => void;
  reload: () => Promise<void>;
  setDoc: (update: (doc: DocumentJson) => DocumentJson) => void;
  track: Track;
  onSent: () => void;
  onTemplateSaved: () => void;
}

function problem(error: unknown, key?: string): string {
  if (error instanceof ApiFailure && error.body.fields) return (key ? error.body.fields[key] : Object.values(error.body.fields)[0]) ?? GENERIC_FAILURE;
  return GENERIC_FAILURE;
}

export function Routing(props: RoutingProps) {
  const { doc, canManage, announce, reload, setDoc, track } = props;
  const draft = doc.status === "draft";
  const inProgress = doc.status === "in_progress";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameBox = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const refocus = useRef<{ id: string; which: "up" | "down" } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const dragging = useRef<{ id: string } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (!target || !list.current) return;
    refocus.current = null;
    const recipient = doc.recipients.find((r) => r.id === target.id);
    if (!recipient) return;
    const wanted = list.current.querySelector<HTMLButtonElement>(`button[aria-label="Move ${recipient.name} ${target.which}"]`);
    const other = list.current.querySelector<HTMLButtonElement>(`button[aria-label="Move ${recipient.name} ${target.which === "up" ? "down" : "up"}"]`);
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [doc.recipients]);

  const add = async (event?: FormEvent) => {
    event?.preventDefault();
    setErrors({});
    try {
      const created = await track(api.post<RecipientJson>(`/api/documents/${doc.id}/recipients`, { name, email }));
      setDoc((d) => ({ ...d, recipients: [...d.recipients, created] }));
      setName("");
      setEmail("");
      nameBox.current?.focus();
    } catch (error) {
      if (error instanceof ApiFailure && error.body.fields) setErrors(error.body.fields);
      else setErrors({ general: GENERIC_FAILURE });
    }
  };

  const move = async (recipient: RecipientJson, direction: "up" | "down") => {
    refocus.current = { id: recipient.id, which: direction };
    try {
      const result = await track(api.post<{ recipients: RecipientJson[] }>(`/api/documents/${doc.id}/recipients/${recipient.id}/move`, { direction }));
      setDoc((d) => ({ ...d, recipients: result.recipients }));
      const order = result.recipients.find((r) => r.id === recipient.id)?.order ?? recipient.order;
      announce(`${recipient.name} is now signer ${order} of ${result.recipients.length}`);
    } catch {
      refocus.current = null;
      await reload();
    }
  };

  const remove = async (recipient: RecipientJson) => {
    await track(api.del(`/api/documents/${doc.id}/recipients/${recipient.id}`));
    await reload();
    nameBox.current?.focus();
  };

  const grab = (event: PointerEvent<HTMLSpanElement>, recipient: RecipientJson) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { id: recipient.id };
  };

  const sweep = async (event: PointerEvent<HTMLSpanElement>, recipient: RecipientJson) => {
    if (dragging.current?.id !== recipient.id || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("li[data-row]")];
    const index = doc.recipients.findIndex((r) => r.id === recipient.id);
    const above = rows[index - 1]?.getBoundingClientRect();
    const below = rows[index + 1]?.getBoundingClientRect();
    if (above && event.clientY < above.top + above.height / 2) await move(recipient, "up");
    else if (below && event.clientY > below.top + below.height / 2) await move(recipient, "down");
  };

  const newLink = async (recipient: RecipientJson) => {
    announce("Issuing a new link...");
    try {
      await api.post(`/api/documents/${doc.id}/recipients/${recipient.id}/new-link`);
      announce(`New link issued for ${recipient.name}.`);
      await reload();
    } catch (error) {
      announce(problem(error));
    }
  };

  const remind = async () => {
    announce("Sending reminder...");
    try {
      await api.post(`/api/documents/${doc.id}/remind`);
      const current = doc.recipients.find((r) => r.order === doc.currentOrder);
      announce(`Reminder sent to ${current?.name ?? ""}.`);
      await reload();
    } catch (error) {
      announce(error instanceof ApiFailure && error.body.error === "mail_unavailable" ? "Email is unavailable. Try the reminder again later." : GENERIC_FAILURE);
      await reload();
    }
  };

  const current = doc.recipients.find((r) => r.order === doc.currentOrder);
  const cooling = doc.reminderAvailableAt !== null;
  const reminderVisible = inProgress && canManage && current !== undefined && (current.status === "invited" || current.status === "viewed");

  const changeZone = async (timeZone: string) => {
    setDoc((d) => ({ ...d, timeZone }));
    await track(api.patch(`/api/documents/${doc.id}`, { timeZone })).catch(() => reload());
  };

  return (
    <div className="routing">
      <h2>Signing order</h2>
      <ol className="order" aria-label="Signing order" ref={list}>
        {doc.recipients.map((recipient, index) => (
          <li key={recipient.id} data-row className={`row status-${recipient.status}`}>
            <span className={`num ${recipient.status === "signed" ? "signed" : ""}`} aria-hidden="true">
              {recipient.order}
            </span>
            <span className="sr-only">{recipient.order}. </span>
            <span className="who">
              <span className="who-name">{recipient.name}</span>
              <span className="who-email">{recipient.email}</span>
              <span className="who-status">
                {rowWord(recipient.status, recipient.delivery)}
                {recipient.status === "signed" && !recipient.binding ? <span className="not-binding"> Not binding</span> : null}
              </span>
            </span>
            <span className="row-actions">
              {draft && canManage ? (
                <>
                  <span
                    className="grip"
                    aria-hidden="true"
                    onPointerDown={(event) => grab(event, recipient)}
                    onPointerMove={(event) => void sweep(event, recipient)}
                    onPointerUp={() => void (dragging.current = null)}
                  >
                    <GripVertical size={18} />
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Move ${recipient.name} up`} disabled={index === 0} onClick={() => void move(recipient, "up")}>
                    <ChevronUp size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${recipient.name} down`} disabled={index === doc.recipients.length - 1} onClick={() => void move(recipient, "down")}>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${recipient.name}`} onClick={() => void remove(recipient)}>
                    <X size={18} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {inProgress && canManage && recipient.status === "expired" ? (
                <button type="button" className="btn small" onClick={() => void newLink(recipient)}>
                  Send a new link
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {doc.recipients.length === 0 ? <p className="muted">No signers yet.</p> : null}
      <Status label="Signing order updates" className="updates">
        {props.updates}
      </Status>
      {draft && canManage ? (
        <form className="stack add-signer" onSubmit={(event) => void add(event)}>
          <label className="field-label">
            Name
            <input ref={nameBox} type="text" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors["name"])} />
          </label>
          {errors["name"] ? <p role="alert" className="error">{errors["name"]}</p> : null}
          <label className="field-label">
            Email
            <input type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors["email"])} />
          </label>
          {errors["email"] ? <p role="alert" className="error">{errors["email"]}</p> : null}
          {errors["recipients"] ? <p role="alert" className="error">{errors["recipients"]}</p> : null}
          {errors["general"] ? <p role="alert" className="error">{errors["general"]}</p> : null}
          <button type="submit" className="btn">
            Add signer
          </button>
        </form>
      ) : null}
      {draft ? (
        <label className="field-label">
          Time zone
          <select value={doc.timeZone} disabled={!canManage} onChange={(e) => void changeZone(e.target.value)}>
            {ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="actions">
        {draft && canManage ? (
          <button type="button" className="btn seal" onClick={() => setSending(true)}>
            Send for signing
          </button>
        ) : null}
        {reminderVisible ? (
          <button type="button" className="btn" disabled={cooling} onClick={() => void remind()}>
            {cooling && doc.reminderAvailableAt ? `Next reminder after ${zonedMinute(doc.reminderAvailableAt, doc.timeZone)} ${doc.timeZone}` : "Send reminder"}
          </button>
        ) : null}
        {inProgress && canManage ? (
          <button type="button" className="btn" onClick={() => setVoiding(true)}>
            Void document
          </button>
        ) : null}
        {draft && props.isOwnerRole ? <TemplateButton doc={doc} done={props.onTemplateSaved} /> : null}
        <Link to={`/documents/${doc.id}/audit`} className="textlink">
          Audit trail
        </Link>
      </div>
      {sending ? <SendDialog doc={doc} close={() => setSending(false)} announce={announce} done={props.onSent} reload={reload} /> : null}
      {voiding ? <VoidDialog doc={doc} close={() => setVoiding(false)} announce={announce} reload={reload} /> : null}
    </div>
  );
}

function TemplateButton({ doc, done }: { doc: DocumentJson; done: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        api.post(`/api/documents/${doc.id}/template`).then(done, () => undefined).finally(() => setBusy(false));
      }}
    >
      Save as template
    </button>
  );
}

function SendDialog({ doc, close, announce, done, reload }: { doc: DocumentJson; close: () => void; announce: (t: string) => void; done: () => void; reload: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const send = async () => {
    setBusy(true);
    setError("");
    announce("Sending...");
    try {
      await api.post(`/api/documents/${doc.id}/send`, undefined, { "Idempotency-Key": key.current });
      const first = doc.recipients[0];
      announce(`Sent for signing. ${first?.name ?? ""} has the first turn.`);
      close();
      await reload();
      done();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.body.error === "missing_signature_fields") {
        const names = (failure.body["recipients"] as string[]).join(", ");
        setError(`Every signer needs a signature field. Missing: ${names}`);
      } else setError(failure instanceof ApiFailure && failure.body.error === "no_recipients" ? "Add at least one signer first." : GENERIC_FAILURE);
      setBusy(false);
    }
  };
  return (
    <Dialog label="Send for signing" onClose={close}>
      <h2>Send for signing</h2>
      <ol className="send-list">
        {doc.recipients.map((r) => (
          <li key={r.id}>{`${r.order}. ${r.name} (${r.email})`}</li>
        ))}
      </ol>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn seal" disabled={busy} aria-busy={busy} onClick={() => void send()}>
          Send
        </button>
      </div>
    </Dialog>
  );
}

function VoidDialog({ doc, close, announce, reload }: { doc: DocumentJson; close: () => void; announce: (t: string) => void; reload: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    setBusy(true);
    setError("");
    announce("Voiding...");
    try {
      await api.post(`/api/documents/${doc.id}/void`, { reason });
      close();
      await reload();
    } catch (failure) {
      setError(problem(failure, "reason"));
      setBusy(false);
      box.current?.focus();
    }
  };
  const count = Array.from(reason).length;
  return (
    <Dialog label="Void document" onClose={close}>
      <h2>Void document</h2>
      <label className="field-label">
        Reason
        <textarea
          ref={box}
          rows={4}
          value={reason}
          data-autofocus
          onChange={(e) => setReason(Array.from(e.target.value).slice(0, VOID_LIMIT).join(""))}
        />
      </label>
      <p className="counter mono">{`${count} of ${VOID_LIMIT} characters`}</p>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
          Void
        </button>
      </div>
    </Dialog>
  );
}
