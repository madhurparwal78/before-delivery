import { StrictMode, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { api, ApiError, type Person, type Vault, type Credential, displayOfficeDate } from './api.js';
import { useApp } from './core.js';
import { DeskShell, type Navigate } from './shell.js';
import { displayName } from './drawer.js';
import { getEvents } from './events.js';
import { Dialog } from './dialog.js';

/* ------------------------------------------------------------------ */
/* Rotation calendar                                                   */
/* ------------------------------------------------------------------ */

interface CalendarDay {
  office_date: string;
  offset: string;
  entries: Array<{
    turn_id: string | null;
    rotation_id: string | null;
    credential_id: string;
    label: string;
    vendor: { name: string; formerly: string | null };
    kind: string;
    office_time: string | null;
    offset: string;
    at: string | null;
    shifted: boolean;
    due_by: string;
    state: string;
  }>;
}

export function Rotations(props: { navigate: Navigate; month: string }): ReactNode {
  const { clock, status, alert } = useApp();
  const [month, setMonth] = useState(props.month || '');
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (props.month === '') {
      const current = clock?.office_date?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
      setMonth(current);
      props.navigate(`/rotations?month=${current}`, true);
    } else {
      setMonth(props.month);
    }
  }, [props.month, clock?.office_date]);

  useEffect(() => {
    if (!month) return;
    void api<{ month: string; days: CalendarDay[] }>('GET', `/api/rotations/calendar?month=${month}`)
      .then((answer) => setDays(answer.days))
      .catch(() => undefined);
  }, [month]);

  const changeMonth = (delta: number): void => {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    setMonth(next);
    props.navigate(`/rotations?month=${next}`);
  };

  return (
    <DeskShell navigate={props.navigate}>
      <main className="screen">
        <h1>Rotation calendar</h1>
        <div className="month-controls">
          <button onClick={() => changeMonth(-1)}>Previous month</button>
          <span className="month-label">{month}</span>
          <button onClick={() => changeMonth(1)}>Next month</button>
        </div>
        {days === null ? (
          <p className="loading">Opening the drawer</p>
        ) : (
          <ul className="rotation-days" aria-label="Office days">
            {days.map((day) => (
              <li key={day.office_date} className="rotation-day">
                <span className="day-label">
                  {displayOfficeDate(day.office_date)} ({day.offset})
                </span>
                <span className="day-entries">
                  {day.entries.map((entry, index) => (
                    <span key={`${entry.credential_id}-${index}`} className="day-entry">
                      {entry.label} ({entry.vendor.name}) · {entry.kind === 'scheduled' ? `${entry.office_time ?? ''} ` : 'turn due '}
                      · {entry.state}
                      {entry.shifted ? ' · Moved from 02:30: the clocks skip that hour.' : ''}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {useApp().me?.role === 'office_manager' ? (
          <button className="solid" onClick={() => setDialogOpen(true)}>Schedule rotation</button>
        ) : null}
        {dialogOpen ? <ScheduleRotationDialog onClose={() => setDialogOpen(false)} status={status} alert={alert} /> : null}
      </main>
    </DeskShell>
  );
}

function ScheduleRotationDialog(props: {
  onClose: () => void;
  status: (message: string) => void;
  alert: (message: string) => void;
}): ReactNode {
  const [credentials, setCredentials] = useState<Array<{ id: string; label: string; vendorName: string }>>([]);
  const [credentialId, setCredentialId] = useState('');
  const [intervalDays, setIntervalDays] = useState('90');
  const [atTime, setAtTime] = useState('02:30');
  const [firstRunOn, setFirstRunOn] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    void (async () => {
      const vaults = await api<{ vaults: Vault[] }>('GET', '/api/vaults');
      const list: Array<{ id: string; label: string; vendorName: string }> = [];
      for (const vault of vaults.vaults) {
        const detail = await api<{ credentials: Credential[] }>('GET', `/api/vaults/${vault.id}`);
        for (const credential of detail.credentials) {
          list.push({ id: credential.id, label: credential.label, vendorName: credential.vendor.name });
        }
      }
      setCredentials(list);
      setCredentialId(list[0]?.id ?? '');
    })().catch(() => undefined);
  }, []);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await api<{ next_runs: Array<{ office_date: string; office_time: string; offset: string }> }>(
        'POST',
        '/api/rotations',
        {
          credential_id: credentialId,
          interval_days: Number(intervalDays),
          at_time: atTime,
          first_run_on: firstRunOn
        }
      );
      const next = answer.next_runs[0];
      props.status(`Rotation scheduled. Next turn ${displayOfficeDate(next.office_date)} ${next.office_time} ${next.offset}.`);
      props.onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        props.alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Schedule rotation" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Schedule rotation</h2>
        <label>
          Login
          <select ref={firstField} value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {`${credential.label} (${credential.vendorName})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Every (days)
          <input type="number" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} />
          {fields.interval_days ? <span className="field-error">{fields.interval_days}</span> : null}
        </label>
        <label>
          Office time
          <input type="time" value={atTime} onChange={(event) => setAtTime(event.target.value)} />
          {fields.at_time ? <span className="field-error">{fields.at_time}</span> : null}
        </label>
        <label>
          First run on
          <input type="date" value={firstRunOn} onChange={(event) => setFirstRunOn(event.target.value)} />
          {fields.first_run_on ? <span className="field-error">{fields.first_run_on}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>{pending ? 'Saving' : 'Save schedule'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Access reviews                                                      */
/* ------------------------------------------------------------------ */

interface ReviewLine {
  id: string;
  person_id: string;
  person_name: string;
  vault_id: string;
  vault_name: string;
  vault_formerly: string | null;
  vendors: Array<{ name: string; formerly: string | null }>;
  decision: string;
  decided_by: string | null;
  decided_via: string | null;
}

interface ReviewDetail {
  id: string;
  quarter: string;
  status: string;
  decided: number;
  total: number;
  lines: ReviewLine[];
}

export function Reviews(props: { navigate: Navigate }): ReactNode {
  const { me, status, alert } = useApp();
  const [reviews, setReviews] = useState<Array<{ id: string; quarter: string; status: string; opened_on: string; overdue_from: string; signed_off_by: string | null }> | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [confirmLine, setConfirmLine] = useState<ReviewLine | null>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);

  const loadReviews = useCallback(async (): Promise<void> => {
    const answer = await api<{ reviews: Array<{ id: string; quarter: string; status: string; opened_on: string; overdue_from: string; signed_off_by: string | null }> }>('GET', '/api/reviews');
    setReviews(answer.reviews);
    if (answer.reviews.length > 0) {
      const current = await api<ReviewDetail>('GET', `/api/reviews/${answer.reviews[0].id}`);
      setDetail(current);
    }
  }, []);

  useEffect(() => {
    void loadReviews().catch(() => undefined);
    const events = getEvents();
    const off = events.on('review-changed', () => {
      void loadReviews().catch(() => undefined);
    });
    const offOpened = events.on('review-opened', () => {
      void loadReviews().catch(() => undefined);
    });
    return () => {
      off();
      offOpened();
    };
  }, []);

  const decide = async (line: ReviewLine, decision: 'keep' | 'remove'): Promise<void> => {
    if (!detail) return;
    try {
      await api('POST', `/api/reviews/${detail.id}/lines/${line.id}`, { decision });
      const kept = decision === 'keep' ? 'kept on' : 'removed from';
      await loadReviews();
      const fresh = reviews !== null ? await api<ReviewDetail>('GET', `/api/reviews/${reviews[0].id}`) : null;
      const decided = fresh ? fresh.decided : detail.decided + 1;
      status(`${line.person_name} ${kept} ${line.vault_name}. ${decided} of ${detail.total} lines decided.`);
      focusNextUndecided(line.id);
    } catch (error) {
      if (error instanceof ApiError) alert(error.message);
    }
  };

  const focusNextUndecided = (decidedLineId: string): void => {
    requestAnimationFrame(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-keep-button="true"]'));
      const target = buttons.find((button) => !button.dataset.decided);
      target?.focus();
      void decidedLineId;
    });
  };

  const signOff = async (): Promise<void> => {
    if (!detail) return;
    try {
      await api('POST', `/api/reviews/${detail.id}/sign-off`, {});
      status('Review signed off.');
      await loadReviews();
    } catch (error) {
      if (error instanceof ApiError) alert(error.message);
    }
  };

  return (
    <DeskShell navigate={props.navigate}>
      <main className="screen">
        <h1>Access reviews</h1>
        {detail ? (
          <section aria-label={`${detail.quarter} access review`} className="review-region">
            <h2>{detail.quarter} access review</h2>
            <p className="review-status">{detail.status === 'open' ? 'Open' : detail.status === 'overdue' ? 'Overdue' : 'Signed off'}</p>
            <p className="review-progress" role="status" aria-label="Review progress">
              {`${detail.decided} of ${detail.total} lines decided`}
            </p>
            <ul className="review-lines">
              {detail.lines.map((line) => (
                <li key={line.id} className="slip review-line">
                  <span className="line-person">{line.person_name}</span>
                  <span className="line-vault">{displayName(line.vault_name, line.vault_formerly)}</span>
                  {line.decision === 'undecided' ? (
                    me?.role === 'office_manager' ? (
                      <span className="line-buttons">
                        <button
                          data-keep-button="true"
                          data-decided={line.decision !== 'undecided' ? 'true' : undefined}
                          onClick={() => void decide(line, 'keep')}
                        >{`Keep ${line.person_name} on ${line.vault_name}`}</button>
                        <button onClick={() => {
                          setConfirmLine(line);
                          requestAnimationFrame(() => removeButtonRef.current?.focus());
                        }}>{`Remove ${line.person_name} from ${line.vault_name}`}</button>
                      </span>
                    ) : (
                      <span className="line-undecided">Undecided</span>
                    )
                  ) : line.decision === 'kept' ? (
                    <span className="line-decision">Kept</span>
                  ) : line.decided_via === 'scope_change' ? (
                    <span className="line-decision">Removed by scope change</span>
                  ) : (
                    <span className="line-decision">Removed</span>
                  )}
                </li>
              ))}
            </ul>
            {me?.role === 'managing_partner' ? (
              <button className="solid" onClick={() => void signOff()}>Sign off review</button>
            ) : null}
          </section>
        ) : (
          <p className="loading">Opening the drawer</p>
        )}
        {reviews && reviews.length > 1 ? (
          <section aria-label="Past reviews" className="past-reviews">
            <h2>Past reviews</h2>
            <div role="tablist" aria-label="Past reviews" className="past-review-tabs">
              {reviews.slice(1).map((review) => (
                <div key={review.id} role="tab" tabIndex={0} aria-label={review.quarter} className="past-review-tab">
                  {review.quarter}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {confirmLine && detail ? (
          <RemoveConfirmDialog
            line={confirmLine}
            onConfirm={() => {
              const line = confirmLine;
              setConfirmLine(null);
              void decide(line, 'remove');
            }}
            onCancel={() => {
              setConfirmLine(null);
              removeButtonRef.current?.focus();
            }}
            ref={removeButtonRef}
          />
        ) : null}
      </main>
    </DeskShell>
  );
}

function RemoveConfirmDialog(props: {
  line: ReviewLine;
  onConfirm: () => void;
  onCancel: () => void;
  ref: React.RefObject<HTMLButtonElement>;
}): ReactNode {
  return (
    <Dialog label={`Remove ${props.line.person_name} from ${props.line.vault_name}`} onClose={props.onCancel} returnRef={props.ref}>
      <div className="dialog-body paper slip">
        <p>{`Their access to ${props.line.vault_name} ends now.`}</p>
        <div className="dialog-buttons">
          <button ref={props.ref} className="solid" onClick={props.onConfirm}>Remove access</button>
          <button onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function People(props: { navigate: Navigate }): ReactNode {
  const { me, status, alert } = useApp();
  const [people, setPeople] = useState<Person[] | null>(null);
  type PeopleDialog = { kind: 'joiner' } | { kind: 'change'; person: Person } | { kind: 'leave'; person: Person };
  const [dialog, setDialog] = useState<PeopleDialog | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const answer = await api<{ people: Person[] }>('GET', '/api/people');
    setPeople(answer.people);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    const events = getEvents();
    const off = events.on('seat-confirmed', () => {
      void load().catch(() => undefined);
    });
    const offBilling = events.on('billing-changed', () => {
      void load().catch(() => undefined);
    });
    return () => {
      off();
      offBilling();
    };
  }, []);

  return (
    <DeskShell navigate={props.navigate}>
      <main className="screen">
        <h1>People</h1>
        {people === null ? (
          <p className="loading">Opening the drawer</p>
        ) : (
          <table className="people-table">
            <caption className="sr-only">People</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Seat</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>{person.full_name}</td>
                  <td>{roleLabel(person.role)}</td>
                  <td>{person.status}</td>
                  <td>{seatLabel(person.seat)}</td>
                  <td>
                    {me?.role === 'office_manager' && person.id !== me.id ? (
                      <span className="row-actions">
                        <button onClick={() => setDialog({ kind: 'change', person })}>{`Change access for ${person.full_name}`}</button>
                        <button onClick={() => setDialog({ kind: 'leave', person })}>{`Leave for ${person.full_name}`}</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {me?.role === 'office_manager' ? (
          <button className="solid" onClick={() => setDialog({ kind: 'joiner' })}>Add joiner</button>
        ) : null}
        {dialog?.kind === 'joiner' ? (
          <JoinerDialog onClose={() => setDialog(null)} status={status} alert={alert} onReload={load} />
        ) : null}
        {dialog?.kind === 'change' ? (
          <ChangeAccessDialog person={dialog.person} onClose={() => setDialog(null)} status={status} alert={alert} onReload={load} />
        ) : null}
        {dialog?.kind === 'leave' ? (
          <ConfirmLeaveDialog person={dialog.person} onClose={() => setDialog(null)} status={status} alert={alert} onReload={load} />
        ) : null}
      </main>
    </DeskShell>
  );
}

function roleLabel(role: string): string {
  if (role === 'office_manager') return 'Office manager';
  if (role === 'managing_partner') return 'Managing partner';
  if (role === 'staff_accountant') return 'Staff accountant';
  return 'Outside bookkeeper';
}

function seatLabel(seat: string): string {
  if (seat === 'confirmed') return 'Seat confirmed';
  if (seat === 'waiting_on_billing') return 'Waiting on billing';
  if (seat === 'release_waiting') return 'Release waiting on billing';
  return 'Released';
}

function JoinerDialog(props: {
  onClose: () => void;
  status: (m: string) => void;
  alert: (m: string) => void;
  onReload: () => Promise<void>;
}): ReactNode {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState('staff_accountant');
  const [aliases, setAliases] = useState('');
  const [vaultIds, setVaultIds] = useState<string[]>([]);
  const [initialPassword, setInitialPassword] = useState('');
  const [termStarts, setTermStarts] = useState('');
  const [termEnds, setTermEnds] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    void api<{ vaults: Vault[] }>('GET', '/api/vaults').then((answer) => setVaults(answer.vaults));
  }, []);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const person = await api<Person>('POST', '/api/people', {
        full_name: fullName,
        email,
        handle,
        role,
        aliases: aliases === '' ? [] : aliases.split(',').map((a) => a.trim()).filter(Boolean),
        vault_ids: vaultIds,
        initial_password: initialPassword,
        term: role === 'outside_bookkeeper' ? { starts_on: termStarts, ends_on: termEnds } : null
      });
      props.status(
        person.seat === 'confirmed'
          ? `${person.full_name} joined. Seat confirmed by billing.`
          : `${person.full_name} joined. Their seat is waiting on billing.`
      );
      await props.onReload();
      props.onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        props.alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Add joiner" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Add joiner</h2>
        <label>
          Full name
          <input ref={firstField} value={fullName} onChange={(event) => setFullName(event.target.value)} />
          {fields.full_name ? <span className="field-error">{fields.full_name}</span> : null}
        </label>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
          {fields.email ? <span className="field-error">{fields.email}</span> : null}
        </label>
        <label>
          Handle
          <input value={handle} onChange={(event) => setHandle(event.target.value)} />
          {fields.handle ? <span className="field-error">{fields.handle}</span> : null}
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="office_manager">Office manager</option>
            <option value="managing_partner">Managing partner</option>
            <option value="staff_accountant">Staff accountant</option>
            <option value="outside_bookkeeper">Outside bookkeeper</option>
          </select>
          {fields.role ? <span className="field-error">{fields.role}</span> : null}
        </label>
        <label>
          Aliases
          <input value={aliases} onChange={(event) => setAliases(event.target.value)} />
          {fields.aliases ? <span className="field-error">{fields.aliases}</span> : null}
        </label>
        <fieldset>
          <legend>Vaults</legend>
          {vaults.map((vault) => (
            <label key={vault.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={vaultIds.includes(vault.id)}
                onChange={(event) => {
                  setVaultIds((current) =>
                    event.target.checked ? [...current, vault.id] : current.filter((id) => id !== vault.id)
                  );
                }}
              />
              {displayName(vault.name, vault.formerly)}
            </label>
          ))}
          {fields.vault_ids ? <span className="field-error">{fields.vault_ids}</span> : null}
        </fieldset>
        <label>
          Initial password
          <input type="password" value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} />
          {fields.initial_password ? <span className="field-error">{fields.initial_password}</span> : null}
        </label>
        {role === 'outside_bookkeeper' ? (
          <>
            <label>
              Term starts on
              <input type="date" value={termStarts} onChange={(event) => setTermStarts(event.target.value)} />
            </label>
            <label>
              Term ends on
              <input type="date" value={termEnds} onChange={(event) => setTermEnds(event.target.value)} />
              {fields.term ? <span className="field-error">{fields.term}</span> : null}
            </label>
          </>
        ) : null}
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>{pending ? 'Adding' : 'Add to the office'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function ChangeAccessDialog(props: {
  person: Person;
  onClose: () => void;
  status: (m: string) => void;
  alert: (m: string) => void;
  onReload: () => Promise<void>;
}): ReactNode {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [role, setRole] = useState(props.person.role);
  const [aliases, setAliases] = useState(props.person.aliases.join(', '));
  const [termEnds, setTermEnds] = useState(props.person.term?.ends_on ?? '');
  const [vaultIds, setVaultIds] = useState<string[]>(props.person.vault_ids);
  const [fields, setFields] = useState<Record<string, string>>({});
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    void api<{ vaults: Vault[] }>('GET', '/api/vaults').then((answer) => setVaults(answer.vaults));
  }, []);

  const submit = async (): Promise<void> => {
    try {
      await api('PATCH', `/api/people/${props.person.id}`, {
        role,
        aliases: aliases === '' ? [] : aliases.split(',').map((a) => a.trim()).filter(Boolean),
        vault_ids: vaultIds,
        ...(role === 'outside_bookkeeper' ? { term_ends_on: termEnds } : {})
      });
      props.status('Access saved.');
      await props.onReload();
      props.onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        props.alert(error.message);
      }
    }
  };

  return (
    <Dialog label="Change access" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Change access</h2>
        <label>
          Role
          <select ref={firstField} value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="office_manager">Office manager</option>
            <option value="managing_partner">Managing partner</option>
            <option value="staff_accountant">Staff accountant</option>
            <option value="outside_bookkeeper">Outside bookkeeper</option>
          </select>
        </label>
        <fieldset>
          <legend>Vaults</legend>
          {vaults.map((vault) => (
            <label key={vault.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={vaultIds.includes(vault.id)}
                onChange={(event) => {
                  setVaultIds((current) =>
                    event.target.checked ? [...current, vault.id] : current.filter((id) => id !== vault.id)
                  );
                }}
              />
              {displayName(vault.name, vault.formerly)}
            </label>
          ))}
        </fieldset>
        <label>
          Aliases
          <input value={aliases} onChange={(event) => setAliases(event.target.value)} />
          {fields.aliases ? <span className="field-error">{fields.aliases}</span> : null}
        </label>
        {role === 'outside_bookkeeper' ? (
          <label>
            Term ends on
            <input type="date" value={termEnds} onChange={(event) => setTermEnds(event.target.value)} />
            {fields.term ? <span className="field-error">{fields.term}</span> : null}
          </label>
        ) : null}
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>Save access</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function ConfirmLeaveDialog(props: {
  person: Person;
  onClose: () => void;
  status: (m: string) => void;
  alert: (m: string) => void;
  onReload: () => Promise<void>;
}): ReactNode {
  const [pending, setPending] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await api<{ turns_due: Array<{ due_by: string }> }>('POST', `/api/people/${props.person.id}/leave`, {
        confirm: true
      });
      props.status(`${props.person.full_name} has left. ${answer.turns_due.length} logins are due to turn by ${displayOfficeDate(answer.turns_due[0]?.due_by ?? '')}.`);
      await props.onReload();
      props.onClose();
    } catch (error) {
      if (error instanceof ApiError) props.alert(error.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Confirm leaver" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Confirm leaver</h2>
        <p>{`${props.person.full_name} leaves at once. Their access ends everywhere.`}</p>
        <div className="dialog-buttons">
          <button ref={confirmRef} className="solid" onClick={() => void submit()}>{pending ? 'Confirming' : 'Confirm leave'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* My travel                                                           */
/* ------------------------------------------------------------------ */

export function MyTravel(props: { navigate: Navigate }): ReactNode {
  const { me, status } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <DeskShell navigate={props.navigate}>
      <main className="screen">
        <h1>My travel windows</h1>
        <ul className="travel-list">
          {(me?.travel ?? []).map((window) => (
            <li key={window.id} className="slip">
              {window.starts_at} — {window.ends_at}
            </li>
          ))}
        </ul>
        <button className="solid" onClick={() => setDialogOpen(true)}>Add travel window</button>
        {dialogOpen ? <TravelDialog onClose={() => setDialogOpen(false)} status={status} /> : null}
      </main>
    </DeskShell>
  );
}

function TravelDialog(props: { onClose: () => void; status: (m: string) => void }): ReactNode {
  const { me, alert } = useApp();
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    try {
      await api('POST', `/api/people/${me?.id}/travel`, { starts_at: starts, ends_at: ends });
      props.status('Travel window saved.');
      props.onClose();
      window.location.reload();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        alert(error.message);
      }
    }
  };

  return (
    <Dialog label="Travel window" onClose={props.onClose}>
      <div className="dialog-body paper slip">
        <h2>Travel window</h2>
        <label>
          Starts
          <input ref={firstField} type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} />
          {fields.starts_at ? <span className="field-error">{fields.starts_at}</span> : null}
        </label>
        <label>
          Ends
          <input type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} />
          {fields.ends_at ? <span className="field-error">{fields.ends_at}</span> : null}
        </label>
        <div className="dialog-buttons">
          <button className="solid" onClick={() => void submit()}>Save travel window</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

interface BillingAnswer {
  reachable: boolean;
  seats: number | null;
  seat_price: string;
  currency: string;
  next_invoice: { date: string; amount: string } | null;
  licence_term_ends_on: string | null;
  waiting: Array<{ person_id: string; name: string; change: string; since: string }>;
}

export function Billing(): ReactNode {
  const [billing, setBilling] = useState<BillingAnswer | null>(null);

  useEffect(() => {
    const load = (): void => {
      void api<BillingAnswer>('GET', '/api/billing').then(setBilling).catch(() => undefined);
    };
    load();
    const events = getEvents();
    const off = events.on('billing-changed', load);
    const offSeat = events.on('seat-confirmed', load);
    return () => {
      off();
      offSeat();
    };
  }, []);

  return (
    <DeskShell navigate={(to) => { window.location.href = to; }}>
      <main className="screen">
        <h1>Billing</h1>
        {billing === null ? (
          <p className="loading">Opening the drawer</p>
        ) : (
          <>
            {!billing.reachable ? (
              <div className="outage-band" role="alert">
                Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.
              </div>
            ) : null}
            <div className="billing-figures slip">
              <p><strong>Seats in use:</strong> {billing.seats ?? '—'}</p>
              <p><strong>Next invoice:</strong> {billing.next_invoice ? `${billing.next_invoice.date} · $${billing.next_invoice.amount}` : '—'}</p>
              <p><strong>Licence term ends:</strong> {billing.licence_term_ends_on ?? '—'}</p>
            </div>
            <h2>Waiting on billing</h2>
            <ul aria-label="Waiting on billing" className="waiting-list">
              {billing.waiting.length === 0 ? <li>No changes waiting.</li> : null}
              {billing.waiting.map((entry) => (
                <li key={`${entry.person_id}-${entry.change}`} className="slip">
                  {entry.name} · {entry.change === 'add' ? 'Add' : 'Release'} · Waiting on billing
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </DeskShell>
  );
}

/* ------------------------------------------------------------------ */
/* Health report                                                       */
/* ------------------------------------------------------------------ */

interface HealthAnswer {
  office_date: string;
  feed: 'ok' | 'unreachable';
  last_good_check_at: string | null;
  counts: { exposed: number; vendor_breached: number; out_of_policy: number; turns_due: number; turns_overdue: number };
  credentials: Array<{ id: string; health: string }>;
}

export function HealthReport(): ReactNode {
  const { clock, status, alert } = useApp();
  const [day, setDay] = useState('');
  const [report, setReport] = useState<HealthAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (day === '' && clock) setDay(clock.office_date);
  }, [clock]);

  useEffect(() => {
    if (day === '') return;
    const requestId = ++requestRef.current;
    void api<HealthAnswer>('GET', `/api/health-report?day=${day}`)
      .then((answer) => {
        if (requestRef.current === requestId) setReport(answer);
      })
      .catch(() => undefined);
  }, [day]);

  useEffect(() => {
    const events = getEvents();
    const off = events.on('check-finished', () => {
      if (clock) setDay(clock.office_date);
    });
    return () => off();
  }, [clock]);

  const checkNow = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    try {
      await api('POST', '/api/health-report/checks', {});
      if (clock) setDay(clock.office_date);
      const answer = await api<HealthAnswer>('GET', `/api/health-report?day=${clock?.office_date ?? day}`);
      setReport(answer);
      status(`Breach check finished.`);
    } catch (error) {
      if (error instanceof ApiError) alert(error.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <DeskShell navigate={(to) => { window.location.href = to; }}>
      <main className="screen">
        <h1>Health report</h1>
        <p>{`Report for ${report ? displayOfficeDate(report.office_date) : ''} (America/Chicago)`}</p>
        {report?.feed === 'unreachable' ? (
          <div className="outage-band" role="alert">
            {report.last_good_check_at
              ? `The breach feed can't be reached. Showing the last good check from ${report.last_good_check_at}.`
              : `The breach feed can't be reached. No check has succeeded yet.`}
          </div>
        ) : null}
        <label>
          Office day
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        {report ? (
          <ul className="health-counts">
            <li>Exposed: {report.counts.exposed}</li>
            <li>Vendor breached: {report.counts.vendor_breached}</li>
            <li>Out of policy: {report.counts.out_of_policy}</li>
            <li>Turns due: {report.counts.turns_due}</li>
            <li>Turns overdue: {report.counts.turns_overdue}</li>
          </ul>
        ) : (
          <p className="loading">Opening the drawer</p>
        )}
        <button className="solid" onClick={() => void checkNow()}>{checking ? 'Checking the breach feed' : 'Check now'}</button>
      </main>
    </DeskShell>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

interface ImportRow {
  row: number;
  outcome: string;
  credential_id: string | null;
  reason: string | null;
  names: Array<{
    text: string;
    match: string | null;
    person_id: string | null;
    held: string | null;
    candidates: Array<{ person_id: string; full_name: string }>;
  }>;
}

export function Import(): ReactNode {
  const { status, alert } = useApp();
  const [result, setResult] = useState<{ id: string; filename: string; counts: Record<string, number>; rows: ImportRow[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    if (pending) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPending(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const answer = await api<{ id: string; filename: string; counts: Record<string, number>; rows: ImportRow[] }>(
        'POST',
        '/api/imports',
        {
          filename: file.name,
          file_base64: base64
        }
      );
      status(`${answer.counts.created} filed, ${answer.counts.matched} already on file, ${answer.counts.held} held for your choice, ${answer.counts.rejected} rejected.`);
      setResult(answer);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields) setFields(error.fields);
        alert(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <DeskShell navigate={(to) => { window.location.href = to; }}>
      <main className="screen">
        <h1>Import a spreadsheet</h1>
        <label>
          Spreadsheet file
          <input ref={fileRef} type="file" accept=".csv,text/csv" />
          {fields.file_base64 ? <span className="field-error">{fields.file_base64}</span> : null}
        </label>
        <button className="solid" onClick={() => void submit()}>{pending ? 'Importing' : 'Import rows'}</button>
        {result ? (
          <>
            <h2>{result.filename}</h2>
            <table className="import-rows">
              <caption className="sr-only">Import rows</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Names</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.outcome === 'held' ? 'Held for your choice' : row.outcome}</td>
                    <td>{row.reason}</td>
                    <td>
                      {row.names.map((name) =>
                        name.held ? (
                          <HeldNameChoice
                            key={name.text}
                            importId={result.id}
                            rowNumber={row.row}
                            name={name}
                            status={status}
                            alert={alert}
                          />
                        ) : (
                          <span key={name.text}>{name.text} → {name.match}</span>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </main>
    </DeskShell>
  );
}

function HeldNameChoice(props: {
  importId: string;
  rowNumber: number;
  name: ImportRow['names'][number];
  status: (m: string) => void;
  alert: (m: string) => void;
}): ReactNode {
  const [personId, setPersonId] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async (): Promise<void> => {
    try {
      await api('POST', `/api/imports/${props.importId}/rows/${props.rowNumber}/choice`, {
        text: props.name.text,
        person_id: personId === '' ? null : personId
      });
      props.status('Choice saved.');
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError) props.alert(error.message);
    }
  };

  if (saved) return <span>{props.name.text}: choice saved</span>;

  return (
    <span className="held-choice">
      <label>
        {`Who is ${props.name.text}?`}
        <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
          <option value="">Not on record</option>
          {props.name.candidates.map((candidate) => (
            <option key={candidate.person_id} value={candidate.person_id}>
              {candidate.full_name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void save()}>Save choice</button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  office_day: string;
  office_time: string;
  offset: string;
  actor: { person_id?: string; name?: string; system?: string };
  action: string;
  subject: { kind: string; id: string; name: string };
  details: Record<string, unknown>;
}

export function Audit(props: { navigate: Navigate; day: string }): ReactNode {
  const { clock } = useApp();
  const [day, setDay] = useState(props.day || '');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (props.day === '' && clock) {
      setDay(clock.office_date);
      props.navigate(`/audit?day=${clock.office_date}`, true);
    } else {
      setDay(props.day);
    }
  }, [props.day, clock]);

  const loadPage = useCallback(async (after: string | null): Promise<{ entries: AuditEntry[]; next_cursor: string | null }> => {
    const query = new URLSearchParams({ day });
    if (after) query.set('after', after);
    return api<{ entries: AuditEntry[]; next_cursor: string | null }>('GET', `/api/audit?${query.toString()}`);
  }, [day]);

  useEffect(() => {
    if (day === '') return;
    void loadPage(null).then((answer) => {
      setEntries(answer.entries);
      setCursor(answer.next_cursor);
    });
  }, [day, loadPage]);

  const more = async (): Promise<void> => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const answer = await loadPage(cursor);
      setEntries((current) => [...current, ...answer.entries]);
      setCursor(answer.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const changeDay = (value: string): void => {
    setDay(value);
    props.navigate(`/audit?day=${value}`);
  };

  return (
    <DeskShell navigate={props.navigate} hideFooter>
      <main className="screen audit-screen">
        <h1>Audit trail</h1>
        <label>
          Office day
          <input type="date" value={day} onChange={(event) => changeDay(event.target.value)} />
        </label>
        <table className="audit-entries">
          <caption className="sr-only">Audit entries</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Subject</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} tabIndex={-1}>
                <td>{entry.office_time}</td>
                <td>{entry.actor.system ? 'Lockset' : entry.actor.name}</td>
                <td>{entry.action}</td>
                <td>{entry.subject.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cursor !== null ? (
          <button onClick={() => void more()}>{loadingMore ? 'Loading' : 'More entries'}</button>
        ) : null}
      </main>
    </DeskShell>
  );
}
