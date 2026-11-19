import { useState, useEffect, useRef, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import type { MeJson, ReturnJson, ReminderJson } from '../../../shared/types';
import { TopBar, OwnerTopBar } from '../components/TopBar';
import { Tile } from '../components/Tile';
import { Dialog } from '../components/Dialog';
import type { Session } from '../lib/session';
import { useLiveEvents } from '../lib/live';
import { statusLabel, dateLine } from '../lib/design';

interface Props {
  id: string;
  me: MeJson;
  announce: (line: string) => void;
}

export function ReturnScreen({ id, me, announce }: Props): React.ReactNode {
  const isOwner = me.user.role === 'owner';
  const [ret, setRet] = useState<ReturnJson | null | 'not-found'>(null);
  const [reminders, setReminders] = useState<ReminderJson[]>([]);
  const [draftGross, setDraftGross] = useState('');
  const [draftTax, setDraftTax] = useState('');
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [stateCodes, setStateCodes] = useState<string[]>([]);
  const session: Session = { me, signOut: async () => {} };
  const route = { path: `/returns/${id}`, navigate: () => {} };

  const load = useCallback(async () => {
    try {
      const next = await api.oneReturn(id);
      setRet(next);
      setDraftVersion((current) => current ?? next.version);
      setDraftGross((current) => (current === '' ? next.gross_sales ?? '' : current));
      setDraftTax((current) => (current === '' ? next.tax_due ?? '' : current));
      if (!isOwner) setReminders(await api.reminders(id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setRet('not-found');
      }
    }
  }, [id, isOwner]);

  useEffect(() => {
    void load();
    if (!isOwner) {
      void api.returns('').then((all: { returns: ReturnJson[] }) => {
        setStateCodes([...new Set(all.returns.map((r: ReturnJson) => r.state))].sort());
      });
    }
  }, [id, isOwner]);

  useLiveEvents((event) => {
    if (event.return_id !== id && event.kind !== 'clock_changed' && event.kind !== 'service_state') return;
    void load();
  });

  if (ret === null) {
    return (
      <>
        {isOwner ? <OwnerTopBar clientName={me.user.display_name} session={session} route={route} /> : <TopBar session={session} route={route} />}
        <main className="page">Loading</main>
      </>
    );
  }

  if (ret === 'not-found') {
    return (
      <main className="not-found">
        <h1>Return not found</h1>
        <p>This return doesn&#39;t exist, or you don&#39;t have access to it.</p>
      </main>
    );
  }

  const submitVersion = (latest: boolean): number => {
    if (latest) return ret.version;
    return draftVersion ?? ret.version;
  };

  const handleConflict = (error: ApiError) => {
    const winner = error.body as { return?: { version: number; status: string }; changed_by?: string } | null;
    const winningVersion = winner?.return?.version;
    if (winningVersion !== undefined) {
      setDraftVersion(winningVersion);
      setRet((current) => {
        if (current === null || current === 'not-found') return current;
        return { ...current, version: winningVersion, status: winner?.return?.status ?? current.status };
      });
    }
    const name = winner?.changed_by ?? 'Someone';
    const labels: Record<string, string> = {
      not_started: 'Not started', prepared: 'Prepared', client_approved: 'Client approved',
      filed: 'Filed', packeted: 'Packeted', amended: 'Amended',
    };
    const status = winner?.return?.status ?? ret.status;
    announce(`${name} changed this return first. It is now ${labels[status] ?? status}.`);
  };

  const saveAmounts = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const next = await api.saveAmounts(id, {
        version: submitVersion(false),
        gross_sales: draftGross,
        tax_due: draftTax,
      });
      setRet(next);
      setDraftVersion(next.version);
      announce(`Amounts saved for ${ret.client.name} ${ret.state} ${ret.period_label}.`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          handleConflict(error);
        } else {
          setErrors(error.errors);
          announce(firstMessage(error.errors));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const markPrepared = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const next = await api.prepare(id, {
        version: submitVersion(false),
        gross_sales: draftGross,
        tax_due: draftTax,
      });
      setRet(next);
      setDraftVersion(next.version);
      announce(`${ret.client.name} ${ret.state} ${ret.period_label} is now Prepared.`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) handleConflict(error);
        else {
          setErrors(error.errors);
          announce(firstMessage(error.errors));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {isOwner ? <OwnerTopBar clientName={me.user.display_name} session={session} route={route} /> : <TopBar session={session} route={route} />}
      <main
        className="page return-page"
        data-return-id={ret.id}
        data-status={ret.status}
        data-overdue={String(ret.overdue)}
        data-due-at={ret.due_at}
        data-state={ret.state}
        data-version={ret.version}
        data-rate={ret.edition.rate}
        data-edition={ret.edition.effective_date}
      >
        <h1 tabIndex={-1}>{`${ret.client.name} · ${ret.state_name} ${ret.period_label}`}</h1>
        <Tile ret={ret} stateCodes={stateCodes.length > 0 ? stateCodes : [ret.state]} />
        <p className="due-line">{ret.due_line}</p>
        {ret.carried_from !== null ? <p className="carried-line">Carried from {dateLine(ret.carried_from)}</p> : null}
        <p className="edition-line">
          {`Rule edition effective ${ret.edition.effective_date} · due day ${ret.edition.due_day} · ${ret.edition.carry === 'next_business' ? 'Next business day' : 'Fixed date'} · reference rate ${ret.edition.rate}%`}
        </p>
        <p className="quiet">
          Status: {statusLabel(ret.status)}{ret.overdue ? ' · Overdue' : ''}
        </p>

        {!isOwner ? (
          <>
            {ret.status === 'not_started' || ret.status === 'prepared' ? (
              <form
                className="form form-narrow"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveAmounts();
                }}
              >
                <Field label="Gross sales" error={errors.gross_sales}>
                  <input type="text" value={draftGross} onChange={(event) => setDraftGross(event.target.value)} />
                </Field>
                <Field label="Tax due" error={errors.tax_due}>
                  <input type="text" value={draftTax} onChange={(event) => setDraftTax(event.target.value)} />
                </Field>
                <div className="form-actions">
                  <button type="submit" className="button button-primary">
                    {saving ? 'Saving' : 'Save amounts'}
                  </button>
                  {ret.status === 'not_started' ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void markPrepared()}
                    >
                      Mark prepared
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}
            {ret.status === 'client_approved' ? <FileAction ret={ret} onDone={(next) => { setRet(next); announce(`${ret.client.name} ${ret.state} ${ret.period_label} is now Filed.`); }} /> : null}
            {(ret.status === 'not_started' || ret.status === 'prepared' || ret.status === 'client_approved') && ret.extension === null ? (
              <ExtensionAction ret={ret} announce={announce} onDone={(next) => setRet(next)} />
            ) : null}
            {(ret.status === 'filed' || ret.status === 'packeted') ? (
              <AmendAction ret={ret} announce={announce} onDone={(next) => setRet(next)} />
            ) : null}
            <section aria-label="Reminders" className="return-region">
              <h2>Reminders</h2>
              <ul>
                {reminders.map((reminder) => (
                  <li key={reminder.lead_days}>
                    {`${reminder.lead_days} days before · ${reminderLine(reminder)} · ${reminder.status === 'pending' ? 'Pending' : 'Sent'}`}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <OwnerActions ret={ret} announce={announce} onDone={(next) => setRet(next)} />
        )}

        <section aria-label="Approvals" className="return-region">
          <h2>Approvals</h2>
          {ret.approvals.length === 0 ? <p className="quiet">No approvals yet.</p> : (
            <ul>
              {ret.approvals.map((approval, index) => (
                <li key={index}>
                  {`${approval.action === 'approved' ? 'Approved' : 'Sent back'} by ${approval.by}${approval.reason !== null ? `: ${approval.reason}` : ''}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        {ret.amendments.length > 0 ? (
          <section aria-label="Amendments" className="return-region">
            <h2>Amendments</h2>
            <ul>
              {ret.amendments.map((amendment, index) => (
                <li key={index}>
                  {`Gross sales ${amendment.original.gross_sales} to ${amendment.amended.gross_sales} · tax due ${amendment.original.tax_due} to ${amendment.amended.tax_due}`}
                  {amendment.note !== null ? ` · ${amendment.note}` : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Filing packet" className="return-region">
          <h2>Filing packet</h2>
          {ret.packet === 'ready' ? (
            <a className="link" href={`/api/returns/${ret.id}/packet`} target="_blank" rel="noreferrer">Filing packet</a>
          ) : ret.packet === 'pending' ? (
            <p className="quiet">Packet pending</p>
          ) : null}
        </section>

        <section aria-label="Latest saved return" className="return-region">
          <p>{`Saved: gross sales ${ret.gross_sales ?? ''}, tax due ${ret.tax_due ?? ''}, version ${ret.version}, ${statusLabel(ret.status)}`}</p>
        </section>
      </main>
    </>
  );
}

function reminderLine(reminder: ReminderJson): string {
  const date = new Date(reminder.scheduled_for);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const central = new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = central.getHours();
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${weekdays[central.getDay()]} ${months[central.getMonth()]} ${central.getDate()}, ${display}:${String(central.getMinutes()).padStart(2, '0')} ${ampm} Central`;
}

function FileAction({ ret, onDone }: { ret: ReturnJson; onDone: (next: ReturnJson) => void }): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      onDone(await api.file(ret.id, { version: ret.version }));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="button button-primary" onClick={() => setOpen(true)}>
        Mark filed
      </button>
      {open ? (
        <Dialog label="Mark filed" onClose={() => setOpen(false)} openerRef={ref}>
          <h2>Mark filed</h2>
          <div className="dialog-actions">
            <button type="button" className="button button-primary" onClick={() => void submit()}>
              {saving ? 'Saving' : 'Confirm filing'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function ExtensionAction({ ret, announce, onDone }: {
  ret: ReturnJson;
  announce: (line: string) => void;
  onDone: (next: ReturnJson) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await api.extension(ret.id, { version: ret.version });
      onDone(next);
      setOpen(false);
      announce(`Extended to ${dateLine(next.due_date)}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setRefused(true);
        announce('The deadline for this return has passed.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="button button-secondary" onClick={() => setOpen(true)}>
        File extension
      </button>
      {open ? (
        <Dialog label="File extension" onClose={() => setOpen(false)} openerRef={ref}>
          <h2>File extension</h2>
          {refused ? <p className="field-error">The deadline for this return has passed.</p> : null}
          <div className="dialog-actions">
            <button type="button" className="button button-primary" onClick={() => void submit()}>
              {saving ? 'Saving' : 'Confirm extension'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function AmendAction({ ret, announce, onDone }: {
  ret: ReturnJson;
  announce: (line: string) => void;
  onDone: (next: ReturnJson) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [gross, setGross] = useState(ret.gross_sales ?? '');
  const [tax, setTax] = useState(ret.tax_due ?? '');
  const [note, setNote] = useState('');
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const next = await api.amend(ret.id, {
        version: ret.version,
        gross_sales: gross,
        tax_due: tax,
        note: note === '' ? undefined : note,
      });
      onDone(next);
      setOpen(false);
      announce(`${ret.client.name} ${ret.state} ${ret.period_label} is now Amended.`);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="button button-secondary" onClick={() => setOpen(true)}>
        Record amendment
      </button>
      {open ? (
        <Dialog label="Record amendment" onClose={() => setOpen(false)} openerRef={ref}>
          <h2>Record amendment</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Amended gross sales" error={errors.gross_sales}>
              <input type="text" value={gross} onChange={(event) => setGross(event.target.value)} />
            </Field>
            <Field label="Amended tax due" error={errors.tax_due}>
              <input type="text" value={tax} onChange={(event) => setTax(event.target.value)} />
            </Field>
            <Field label="Note" error={errors.note}>
              <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button type="submit" className="button button-primary">
                {saving ? 'Saving' : 'Save amendment'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function OwnerActions({ ret, announce, onDone }: {
  ret: ReturnJson;
  announce: (line: string) => void;
  onDone: (next: ReturnJson) => void;
}): React.ReactNode {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const sendRef = useRef<HTMLButtonElement>(null);

  const approve = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await api.approve(ret.id, { version: ret.version });
      onDone(next);
      announce(`${ret.state} ${ret.period_label} approved.`);
    } finally {
      setSaving(false);
    }
  };

  const sendBack = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const next = await api.sendBack(ret.id, { version: ret.version, reason });
      onDone(next);
      setSheetOpen(false);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  const canApprove = ret.awaiting_approval;
  const canSendBack = ret.awaiting_approval || ret.status === 'client_approved';

  return (
    <div className="owner-actions">
      {canApprove ? (
        <button type="button" className="button button-primary owner-approve" onClick={() => void approve()}>
          {`Approve ${ret.state} ${ret.period_label}`}
        </button>
      ) : null}
      {canSendBack ? (
        <button ref={sendRef} type="button" className="button button-secondary" onClick={() => setSheetOpen(true)}>
          {`Send back ${ret.state} ${ret.period_label}`}
        </button>
      ) : null}
      {sheetOpen ? (
        <div className={`bottom-sheet-backdrop ${''}`} onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSheetOpen(false);
        }}>
          <div role="dialog" aria-modal="true" aria-label="Send back" className="bottom-sheet">
            <h2>Send back</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendBack();
              }}
            >
              <label className="field">
                <span className="field-label">Reason</span>
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
                {errors.reason !== undefined ? <span className="field-error">{errors.reason}</span> : null}
              </label>
              <div className="dialog-actions">
                <button type="submit" className="button button-primary">
                  {saving ? 'Saving' : 'Send back'}
                </button>
                <button type="button" className="button button-secondary" onClick={() => setSheetOpen(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function firstMessage(errors: Record<string, string>): string {
  const first = Object.values(errors)[0];
  return first ?? 'That didn\u2019t save. Try again.';
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error !== undefined && error !== '' ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
