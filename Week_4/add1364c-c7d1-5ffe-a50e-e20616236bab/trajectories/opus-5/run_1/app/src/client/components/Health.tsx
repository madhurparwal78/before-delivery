import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, type Clock, type HealthReport } from '../api.js';
import { call } from '../guard.js';
import { HEALTH_LABEL, displayName, officeDate } from '../format.js';
import { refuse, say, useLive } from '../live.js';

function stampOf(iso: string, clock: Clock): string {
  // The office stamp of a server instant, read through the office zone the server names.
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.time_zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso));
  const read: Record<string, string> = {};
  for (const part of shown) read[part.type] = part.value;
  const date = `${read.year}-${read.month}-${read.day}`;
  return `${officeDate(date)}, ${read.hour}:${read.minute} ${read.timeZoneName}`;
}

export function Health(props: { clock: Clock }): React.ReactElement {
  const [day, setDay] = useState(props.clock.office_date);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [pending, setPending] = useState(false);
  const wanted = useRef(day);
  wanted.current = day;

  // The report always ends on the last office day picked, whatever order answers arrive in.
  const load = useCallback((forDay: string) => {
    void call<HealthReport>(`/api/health-report?day=${forDay}`)
      .then((answer) => {
        if (wanted.current === forDay) setReport(answer);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => load(day), [day, load]);
  useLive(
    'check-finished',
    useCallback(() => load(wanted.current), [load]),
  );

  const checkNow = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await call<HealthReport>('/api/health-report/checks', { method: 'POST', body: {} });
      setDay(answer.office_date);
      wanted.current = answer.office_date;
      setReport(answer);
      say(`Breach check finished at ${stampOf(answer.last_good_check_at ?? new Date().toISOString(), props.clock)}.`);
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    } finally {
      setPending(false);
    }
  };

  const counts = report?.counts;

  return (
    <main>
      <h1>Health report</h1>
      <p style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <button type="button" onClick={() => void checkNow()}>
          {pending ? 'Checking the breach feed' : 'Check now'}
        </button>
        <span>
          <label htmlFor="health-day">Office day</label>
          <input
            id="health-day"
            type="date"
            max={props.clock.office_date}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </span>
      </p>
      {report !== null && report.feed === 'unreachable' ? (
        <p className="band" role="alert">
          {report.last_good_check_at === null
            ? "The breach feed can't be reached. No check has succeeded yet."
            : `The breach feed can't be reached. Showing the last good check from ${stampOf(report.last_good_check_at, props.clock)}.`}
        </p>
      ) : null}
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Health
        </span>
        <div className="folder-band folder-band--surface">
          <h2>Health report</h2>
          <p>{`Report for ${report === null ? officeDate(day) : officeDate(report.office_date)} (${props.clock.time_zone})`}</p>
          <p className="stamp">
            {report?.last_good_check_at === null || report === null
              ? 'No check has succeeded yet'
              : `Last good check ${stampOf(report.last_good_check_at, props.clock)}`}
          </p>
          <ul className="slips">
            <li className="slip">
              Exposed <span className="count">{counts?.exposed ?? 0}</span>
            </li>
            <li className="slip">
              Vendor breached <span className="count">{counts?.vendor_breached ?? 0}</span>
            </li>
            <li className="slip">
              Out of policy <span className="count">{counts?.out_of_policy ?? 0}</span>
            </li>
            <li className="slip">
              Turns due <span className="count">{counts?.turns_due ?? 0}</span>
            </li>
            <li className="slip">
              Turns overdue <span className="count">{counts?.turns_overdue ?? 0}</span>
            </li>
          </ul>
          <ul className="slips">
            {(report?.credentials ?? []).map((credential) => (
              <li className="slip" key={credential.id}>
                <div className="slip-grid">
                  <span>
                    <strong>{credential.label}</strong>
                    <br />
                    {credential.vendor === null ? '' : displayName(credential.vendor)}
                  </span>
                  <span>{HEALTH_LABEL[credential.health]}</span>
                  <span className="figures">
                    {credential.out_of_policy_since === null
                      ? ''
                      : `Out of policy since ${officeDate(credential.out_of_policy_since)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
