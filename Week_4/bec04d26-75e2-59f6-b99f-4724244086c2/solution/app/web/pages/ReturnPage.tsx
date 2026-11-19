import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { dateWords } from "../../shared/calendar";
import { type FieldErrors, type Reminder, type ReturnAction, type ReturnView, type Role, STATUS_LABELS } from "../../shared/types";
import { announce, PRIORITY } from "../announce";
import { type Answer, get, request } from "../api";
import { conflictLine, DEADLINE_PASSED, SERVER_ERROR } from "../copy";
import { Dialog, useDialogClose } from "../components/Dialog";
import { TextField, useFirstMessage } from "../components/Fields";
import { OwnerBar } from "../components/OwnerBar";
import { ReturnTile, returnData } from "../components/Tile";
import { useLive, useReturn } from "../hooks";
import { noteOwn } from "../live";
import { NotFound } from "./NotFound";

const CARRY_NAMES = { next_business: "Next business day", fixed: "Fixed date" } as const;

type Outcome = { notice: string } | null;

/** A dialog body that sends one POST with the newest version this tab has seen. */
function Confirm({ view, action, confirm, onDone, children }: {
  view: ReturnView; action: "file" | "extension"; confirm: string; onDone: (view: ReturnView) => void; children: ReactNode;
}) {
  const close = useDialogClose();
  const [notice, setNotice] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, notice, true);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<ReturnView>("POST", `/api/returns/${view.id}/${action}`, { version: view.version });
    if (answer.ok) {
      noteOwn(answer.data);
      announce(action === "file" ? `${view.client.name} ${view.state} ${view.period_label} is now Filed.`
        : `Extended to ${dateWords(answer.data.due_date)}.`, action === "file" ? PRIORITY.statusSaved : PRIORITY.extensionGranted);
      onDone(answer.data);
      close();
    } else {
      const failure = answer.failure;
      const text = failure.kind === "conflict" ? conflictLine(failure.body.changed_by, STATUS_LABELS[failure.body.return.status])
        : failure.kind === "deadline" ? DEADLINE_PASSED : SERVER_ERROR;
      announce(text, failure.kind === "conflict" ? PRIORITY.conflict
        : failure.kind === "deadline" ? PRIORITY.extensionRefused : PRIORITY.fieldError);
      setNotice({ notice: text });
    }
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      {children}
      {notice && <p data-notice tabIndex={-1} className="banner">{notice.notice}</p>}
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : confirm}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

function Amend({ view, onDone }: { view: ReturnView; onDone: (view: ReturnView) => void }) {
  const close = useDialogClose();
  const [values, setValues] = useState({ gross: "", tax: "", note: "" });
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [notice, setNotice] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors ?? notice, true);
  const set = (key: keyof typeof values) => (value: string): void => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const answer = await request<ReturnView>("POST", `/api/returns/${view.id}/amend`,
      { version: view.version, gross_sales: values.gross, tax_due: values.tax, note: values.note });
    if (answer.ok) {
      noteOwn(answer.data);
      announce(`${view.client.name} ${view.state} ${view.period_label} is now Amended.`, PRIORITY.statusSaved);
      onDone(answer.data);
      close();
    } else if (answer.failure.kind === "fields") {
      setNotice(null);
      setErrors({ ...answer.failure.errors });
    } else if (answer.failure.kind === "conflict") {
      const text = conflictLine(answer.failure.body.changed_by, STATUS_LABELS[answer.failure.body.return.status]);
      announce(text, PRIORITY.conflict);
      setErrors(null);
      setNotice({ notice: text });
    } else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <TextField label="Amended gross sales" inputMode="decimal" value={values.gross} onChange={set("gross")} error={errors?.gross_sales} />
      <TextField label="Amended tax due" inputMode="decimal" value={values.tax} onChange={set("tax")} error={errors?.tax_due} />
      <TextField label="Note" multiline value={values.note} onChange={set("note")} error={errors?.note} />
      {notice && <p data-notice tabIndex={-1} className="banner">{notice.notice}</p>}
      <div className="actions">
        <button type="submit" className="button primary" aria-disabled={busy}>{busy ? "Saving" : "Save amendment"}</button>
        <button type="button" className="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );
}

function Reminders({ id }: { id: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const load = useCallback(() => void get<Reminder[]>(`/api/returns/${id}/reminders`).then((a) => a.ok && setReminders(a.data)), [id]);
  useEffect(load, [load]);
  useLive((event) => {
    if ((event.type === "return" && event.return.id === id) || (event.type === "reminder" && event.return_id === id)
      || event.type === "practice" || event.type === "lists") load();
  });
  return (
    <div className="block">
      <h2 id="reminders-h">Reminders</h2>
      <section aria-labelledby="reminders-h">
        {reminders.length
          ? <ul>{reminders.map((r) => (
            <li key={r.lead_days}>{`${r.lead_days === 7 ? "7 days" : "1 day"} before · ${r.when} · ${r.status === "sent" ? "Sent" : "Pending"}`}</li>))}</ul>
          : <p className="muted">No reminders are waiting.</p>}
      </section>
    </div>
  );
}

const amount = (value: string | null): string => value ?? "not entered";

export function ReturnPage({ id, role }: { id: string; role: Role }) {
  const { view, missing, replace } = useReturn(id);
  const heading = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<"file" | "extension" | "amend" | null>(null);
  const [draft, setDraft] = useState<{ gross: string; tax: string; version: number } | null>(null);
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFirstMessage(form, errors, false);
  const focusHeading = useCallback(() => heading.current?.focus(), []);

  useEffect(() => {
    if (view && !draft) setDraft({ gross: view.gross_sales ?? "", tax: view.tax_due ?? "", version: view.version });
  }, [view, draft]);

  if (missing) return <NotFound />;
  if (!view || !draft) return <main className="return" aria-busy="true" />;

  const label = `${view.client.name} ${view.state} ${view.period_label}`;
  const can = (action: ReturnAction): boolean => role === "bookkeeper" && view.allowed.includes(action);

  /** Saves the draft with the version the draft last saw; live updates never change that version. */
  const send = async (path: "" | "/prepare"): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const answer: Answer<ReturnView> = await request<ReturnView>(path ? "POST" : "PATCH", `/api/returns/${id}${path}`,
      { version: draft.version, gross_sales: draft.gross, tax_due: draft.tax });
    if (answer.ok) {
      noteOwn(answer.data);
      replace(answer.data);
      setErrors(null);
      setDraft({ ...draft, version: answer.data.version });
      if (path) announce(`${label} is now Prepared.`, PRIORITY.statusSaved);
      else announce(`Amounts saved for ${label}.`, PRIORITY.amountsSaved);
    } else if (answer.failure.kind === "fields") {
      setErrors({ ...answer.failure.errors });
    } else if (answer.failure.kind === "conflict") {
      const body = answer.failure.body;
      announce(conflictLine(body.changed_by, STATUS_LABELS[body.return.status]), PRIORITY.conflict);
      setDraft({ ...draft, version: body.return.version });
      void get<ReturnView>(`/api/returns/${id}`).then((a) => a.ok && replace(a.data));
    } else announce(SERVER_ERROR, PRIORITY.fieldError);
    setBusy(false);
  };

  const submitAmounts = (event: FormEvent): void => {
    event.preventDefault();
    void send("");
  };

  const edition = view.edition;
  return (
    <main className="return" {...returnData(view)}>
      <div className="return-grid">
        <div className="return-body">
          <h1 ref={heading} tabIndex={-1}>{`${view.client.name} · ${view.state_name} ${view.period_label}`}</h1>
          <p className="status-line">
            <span className={`chip tone-${view.overdue ? "black" : view.tone}`}>
              {view.overdue ? `${view.status_label} · Overdue` : view.status_label}
            </span>
          </p>
          <p className="due-line">{view.due_line}</p>
          {view.carried_from && <p className="muted">{`Carried from ${dateWords(view.carried_from)}`}</p>}
          {view.extension && (
            <p className="muted">{`Extension granted: ${view.extension.extension_days} days, moved from ${dateWords(view.extension.due_date_before)}.`}</p>
          )}
          <p className="muted">
            {`Rule edition effective ${edition.effective_date} · due day ${edition.due_day} · ${CARRY_NAMES[edition.carry]} · reference rate ${edition.rate}%`}
          </p>

          {can("save_amounts") ? (
            <form ref={form} onSubmit={submitAmounts} noValidate className="amounts">
              <TextField label="Gross sales" inputMode="decimal" value={draft.gross} error={errors?.gross_sales}
                onChange={(gross) => setDraft({ ...draft, gross })} />
              <TextField label="Tax due" inputMode="decimal" value={draft.tax} error={errors?.tax_due}
                onChange={(tax) => setDraft({ ...draft, tax })} />
              <div className="actions">
                <button type="submit" className={`button${can("prepare") ? "" : " primary"}`} aria-disabled={busy}>
                  {busy ? "Saving" : "Save amounts"}
                </button>
                {can("prepare") && (
                  <button type="button" className="button primary" aria-disabled={busy} onClick={() => void send("/prepare")}>
                    Mark prepared
                  </button>
                )}
              </div>
            </form>
          ) : (
            <dl className="figures">
              <div><dt>Gross sales</dt><dd>{amount(view.gross_sales)}</dd></div>
              <div><dt>Tax due</dt><dd>{amount(view.tax_due)}</dd></div>
            </dl>
          )}

          {role === "bookkeeper" && (
            <div className="actions">
              {can("file") && (
                <button type="button" className="button primary" onClick={() => setDialog("file")}>Mark filed</button>
              )}
              {can("extend") && (
                <button type="button" className="button" onClick={() => setDialog("extension")}>File extension</button>
              )}
              {can("amend") && (
                <button type="button" className="button" onClick={() => setDialog("amend")}>Record amendment</button>
              )}
            </div>
          )}

          {role === "bookkeeper" && <Reminders id={id} />}

          <div className="block">
            <h2 id="approvals-h">Approvals</h2>
            <section aria-labelledby="approvals-h">
              {view.approvals.length ? <ul>{view.approvals.map((a, i) => (
                <li key={i}>{a.action === "approved" ? `${a.by} approved · ${a.when}` : `${a.by} sent back · ${a.when} · ${a.reason}`}</li>
              ))}</ul> : <p className="muted">No approvals yet.</p>}
            </section>
          </div>

          <div className="block">
            <h2 id="amendments-h">Amendments</h2>
            <section aria-labelledby="amendments-h">
              {view.amendments.length ? <ul>{view.amendments.map((a, i) => (
                <li key={i}>
                  <span>{`${a.when} · ${a.by}`}</span>
                  <span>{`Gross sales ${a.original.gross_sales} became ${a.amended.gross_sales}`}</span>
                  <span>{`Tax due ${a.original.tax_due} became ${a.amended.tax_due}`}</span>
                  {a.note && <span>{a.note}</span>}
                </li>
              ))}</ul> : <p className="muted">No amendments.</p>}
            </section>
          </div>

          <div className="block">
            <h2 id="packet-h">Filing packet</h2>
            <section aria-labelledby="packet-h">
              {view.packet === "pending" && <p>Packet pending</p>}
              {view.packet_revisions > 0 && <p><a href={`/api/returns/${id}/packet`} target="_blank" rel="noopener">Filing packet</a></p>}
              {view.packet === "none" && <p className="muted">The packet is made when the return is filed.</p>}
            </section>
          </div>

          <div className="block">
            <h2 id="saved-h">Latest saved return</h2>
            <section aria-labelledby="saved-h">
              {`Saved: gross sales ${amount(view.gross_sales)}, tax due ${amount(view.tax_due)}, version ${view.version}, ${view.status_label}`}
            </section>
          </div>
        </div>
        <aside className="return-tile">
          <ReturnTile view={view} />
        </aside>
      </div>

      {role === "owner" && <OwnerBar view={view} onChanged={replace} fallbackFocus={focusHeading} />}

      {dialog === "file" && (
        <Dialog title="Mark filed" onClose={() => setDialog(null)} fallbackFocus={focusHeading}>
          <Confirm view={view} action="file" confirm="Confirm filing" onDone={replace}>
            <p>Filing records this return as filed, tells the client's owner and makes the filing packet.</p>
          </Confirm>
        </Dialog>
      )}
      {dialog === "extension" && (
        <Dialog title="File extension" onClose={() => setDialog(null)} fallbackFocus={focusHeading}>
          <Confirm view={view} action="extension" confirm="Confirm extension" onDone={replace}>
            <p>{`The edition allows ${edition.extension_days} extra days. The extension is granted once, and only up to the deadline.`}</p>
          </Confirm>
        </Dialog>
      )}
      {dialog === "amend" && (
        <Dialog title="Record amendment" onClose={() => setDialog(null)} fallbackFocus={focusHeading}>
          <Amend view={view} onDone={replace} />
        </Dialog>
      )}
    </main>
  );
}
