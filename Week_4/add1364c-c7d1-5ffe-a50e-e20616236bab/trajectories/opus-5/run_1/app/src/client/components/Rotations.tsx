import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, type Calendar, type Clock, type Credential, type Person, type Vault } from '../api.js';
import { call } from '../guard.js';
import { displayName, officeDate, officeStamp } from '../format.js';
import { refuse, say } from '../live.js';
import { go, useLocation } from '../router.js';
import { Dialog, FieldRow } from './Dialog.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Schedule = {
  id: string;
  credential_id: string;
  interval_days: number;
  at_time: string;
  first_run_on: string;
  next_runs: { office_date: string; office_time: string; offset: string; at: string; shifted: boolean }[];
};

function nextMonth(month: string, step: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + step;
  const moved = new Date(Date.UTC(year, index, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function Rotations(props: { me: Person; clock: Clock }): React.ReactElement {
  const where = useLocation();
  const given = where.query.get('month');
  const month = given !== null && MONTH.test(given) ? given : props.clock.office_date.slice(0, 7);
  const [calendar, setCalendar] = useState<Calendar | null>(null);

  useEffect(() => {
    if (given === null || !MONTH.test(given)) {
      window.history.replaceState(null, '', `/rotations?month=${month}`);
    }
  }, [given, month]);

  const load = useCallback(() => {
    let current = true;
    void call<Calendar>(`/api/rotations/calendar?month=${month}`)
      .then((answer) => {
        if (current) setCalendar(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [month]);

  useEffect(load, [load]);

  return (
    <main>
      <h1>Rotation calendar</h1>
      <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => go(`/rotations?month=${nextMonth(month, -1)}`)}>
          Previous month
        </button>
        <button type="button" onClick={() => go(`/rotations?month=${nextMonth(month, 1)}`)}>
          Next month
        </button>
        {props.me.role === 'office_manager' ? <ScheduleRotation onSaved={load} /> : null}
      </p>
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          {month}
        </span>
        <div className="folder-band folder-band--surface">
          <ul aria-label="Office days">
            {(calendar?.days ?? []).map((day) => (
              <li className="day-row" key={day.office_date}>
                <span className="stamp">
                  {officeDate(day.office_date)} {day.office_date.slice(0, 4)} {day.offset}
                </span>
                <div className="day-runs">
                  {day.entries.map((entry, index) => (
                    <span key={`${entry.credential_id}-${index}`}>
                      {entry.label} ({displayName({ name: entry.vendor.name, formerly: entry.vendor.formerly })}){' '}
                      {entry.office_time === null ? `due by ${officeDate(entry.due_by)}` : `${entry.office_time} ${entry.offset}`}
                      {' — '}
                      {entry.state}
                      {entry.shifted ? ` — Moved from ${movedFrom(entry.office_time)}: the clocks skip that hour.` : ''}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

/** A shifted run reports the wall-clock time the schedule asked for. */
function movedFrom(officeTime: string | null): string {
  if (officeTime === null) return '';
  const hour = Number(officeTime.slice(0, 2));
  return `${String(hour - 1).padStart(2, '0')}:${officeTime.slice(3, 5)}`;
}

function ScheduleRotation(props: { onSaved: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [logins, setLogins] = useState<{ id: string; label: string }[]>([]);
  const [credentialId, setCredentialId] = useState('');
  const [intervalDays, setIntervalDays] = useState('90');
  const [atTime, setAtTime] = useState('02:30');
  const [firstRunOn, setFirstRunOn] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const start = async (): Promise<void> => {
    const vaults = await call<{ vaults: Vault[] }>('/api/vaults').catch(() => ({ vaults: [] }));
    const list: { id: string; label: string }[] = [];
    for (const vault of vaults.vaults) {
      const folder = await call<{ credentials: Credential[] }>(`/api/vaults/${vault.id}`).catch(() => ({
        credentials: [],
      }));
      for (const credential of folder.credentials) {
        list.push({ id: credential.id, label: `${credential.label} (${credential.vendor?.name ?? ''})` });
      }
    }
    setLogins(list);
    setCredentialId(list[0]?.id ?? '');
    setOpen(true);
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const schedule = await call<Schedule>('/api/rotations', {
        method: 'POST',
        body: {
          credential_id: credentialId,
          interval_days: Number(intervalDays),
          at_time: atTime,
          first_run_on: firstRunOn,
        },
      });
      const run = schedule.next_runs[0];
      say(
        run === undefined
          ? 'Rotation scheduled.'
          : `Rotation scheduled. Next turn ${officeStamp(run.office_date, run.office_time, run.offset)}.`,
      );
      setOpen(false);
      props.onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFields(error.fields);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void start()}>
        Schedule rotation
      </button>
      {open ? (
        <Dialog title="Schedule rotation" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <FieldRow label="Login" id="rot-login" message={fields.credential_id}>
              <select id="rot-login" value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
                {logins.map((login) => (
                  <option key={login.id} value={login.id}>
                    {login.label}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Every (days)" id="rot-interval" message={fields.interval_days}>
              <input
                id="rot-interval"
                type="number"
                value={intervalDays}
                onChange={(event) => setIntervalDays(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Office time" id="rot-time" message={fields.at_time}>
              <input id="rot-time" type="time" value={atTime} onChange={(event) => setAtTime(event.target.value)} />
            </FieldRow>
            <FieldRow label="First run on" id="rot-first" message={fields.first_run_on}>
              <input
                id="rot-first"
                type="date"
                value={firstRunOn}
                onChange={(event) => setFirstRunOn(event.target.value)}
              />
            </FieldRow>
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Saving' : 'Save schedule'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
