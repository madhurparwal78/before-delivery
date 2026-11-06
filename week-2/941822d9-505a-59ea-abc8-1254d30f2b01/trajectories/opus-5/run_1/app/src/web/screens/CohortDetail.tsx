import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fieldErrorOf, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { closeLine, ENROLMENT_STATE_LABELS } from '../lib/format.js';
import type { Cohort } from '../lib/types.js';

function cohortCopy(code: string): string | null {
  if (code === 'cap_below_enrolled') return 'The seat cap can\u2019t be lower than the nurses already enrolled.';
  return null;
}

export function CohortDetail({ cohortId }: { readonly cohortId: string }): ReactNode {
  const feedback = useFeedback();
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [seatCap, setSeatCap] = useState(0);
  const [capError, setCapError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await request<{ cohort: Cohort }>(`/api/cohorts/${cohortId}`);
    setCohort(result.cohort);
    setSeatCap(result.cohort.seat_cap);
  }, [cohortId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function saveCap(): Promise<void> {
    if (pending) return;
    setPending(true);
    setCapError(null);
    feedback.announce('Saving…');
    try {
      await request(`/api/cohorts/${cohortId}`, { method: 'PATCH', body: { seat_cap: seatCap } });
      await load();
      feedback.announce('Cohort saved.');
    } catch (error) {
      const message = fieldErrorOf(error, 'seat_cap');
      if (message !== null) {
        setCapError(message);
        feedback.clear();
      } else {
        feedback.report(error, cohortCopy);
      }
    } finally {
      setPending(false);
    }
  }

  if (cohort === null) return <p className="hint">Loading the cohort…</p>;

  return (
    <div className="grid">
      <div className="col-main">
        <h1>{cohort.name}</h1>
        <p className="hint">
          Starts {cohort.starts_on} · {closeLine(cohort.close_date)}
        </p>
        <p className="total-figure">Seats remaining {cohort.seats_remaining}</p>

        <div className="table-wrap">
          <table className="stacked">
            <caption>Roster</caption>
            <thead>
              <tr>
                <th scope="col">Nurse</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {(cohort.roster ?? []).map((entry) => (
                <tr key={entry.enrolment_id}>
                  <td data-label="Nurse">{entry.nurse_name}</td>
                  <td data-label="State">{ENROLMENT_STATE_LABELS[entry.state] ?? entry.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 'var(--h5)', marginTop: '2rem' }}>Waitlist</h2>
        <ol className="rows" aria-label="Waitlist">
          {(cohort.waitlist ?? []).map((entry) => (
            <li key={`${entry.position}-${entry.nurse_name}`} className="row">
              <span className="row__main">
                {entry.position}. {entry.nurse_name}
              </span>
            </li>
          ))}
        </ol>
        {(cohort.waitlist ?? []).length === 0 ? <p className="hint">Nobody is waiting.</p> : null}
      </div>

      <div className="col-side">
        <div className="field">
          <label htmlFor="cohort-seat-cap">Seat cap</label>
          <input
            id="cohort-seat-cap"
            type="number"
            min={1}
            max={500}
            value={seatCap}
            aria-describedby={capError === null ? undefined : 'cohort-seat-cap-error'}
            onChange={(event) => setSeatCap(Number.parseInt(event.target.value, 10) || 0)}
          />
          {capError === null ? null : (
            <p className="field__error" id="cohort-seat-cap-error">
              {capError}
            </p>
          )}
        </div>
        <button type="button" disabled={pending} onClick={() => void saveCap()}>
          {pending ? 'Saving…' : 'Save seat cap'}
        </button>
      </div>
    </div>
  );
}
