import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DeliveryStatusCell } from '../components/figures';
import { formatStoreDate, formatStoreDateTime } from '../../shared/time';
import { DELIVERY_STATUS_ORDER, type RosterResponse, type School } from '../../shared/types';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { serverNow } from '../lib/serverClock';

export function Schools(): ReactNode {
  const [schools, setSchools] = useState<School[]>([]);
  const [summaries, setSummaries] = useState<Record<string, RosterResponse>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const touched = useRef<Record<string, boolean>>({});
  const selectedRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    const answer = await api<{ server_now: string; schools: School[] }>('/schools');
    setSchools(answer.schools);
    const rosters = await Promise.all(
      answer.schools.map((school) => api<RosterResponse>(`/schools/${school.id}/roster`)),
    );
    const next: Record<string, RosterResponse> = {};
    answer.schools.forEach((school, index) => {
      const roster = rosters[index];
      if (roster !== undefined) next[school.id] = roster;
    });
    setSummaries(next);
    const updated: Record<string, string> = { ...selectedRef.current };
    const passedMessages: Record<string, string> = {};
    for (const school of answer.schools) {
      const options = school.upcoming_delivery_days.map((day) => day.date);
      const chosen = selectedRef.current[school.id];
      if (chosen === undefined && touched.current[school.id] !== true) {
        updated[school.id] = options[0] ?? '';
      } else if (chosen !== undefined && chosen !== '' && !options.includes(chosen)) {
        updated[school.id] = '';
        passedMessages[school.id] =
          `Delivery day ${formatStoreDate(chosen)} passed its cutoff. Pick another delivery day.`;
      }
    }
    selectedRef.current = updated;
    setSelected(updated);
    if (Object.keys(passedMessages).length > 0) {
      setStatuses((current) => ({ ...current, ...passedMessages }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      const estimate = serverNow();
      if (estimate === null) return;
      const passed = schools.some((school) =>
        school.upcoming_delivery_days.some((day) => Date.parse(day.cutoff_at) <= estimate),
      );
      if (passed) void load().catch(() => undefined);
    }, 500);
    return () => clearInterval(timer);
  }, [schools, load]);

  const send = async (school: School): Promise<void> => {
    const date = selected[school.id] ?? '';
    setBusy((current) => ({ ...current, [school.id]: true }));
    setStatuses((current) => ({ ...current, [school.id]: PENDING.notice }));
    try {
      const answer = await api<{ recipient: string; student_count: number }>(
        `/schools/${school.id}/delivery-notice`,
        { method: 'POST', body: { delivery_date: date } },
      );
      setStatuses((current) => ({
        ...current,
        [school.id]: `Delivery notice queued for ${answer.recipient} (${answer.student_count} students).`,
      }));
    } catch (error) {
      let message = '';
      if (error instanceof ApiFailure && error.status === 422) message = "Pick one of this school's delivery days.";
      else if (error instanceof NetworkFailure) message = NETWORK_COPY;
      else if (error instanceof ApiFailure) message = error.message;
      setStatuses((current) => ({ ...current, [school.id]: message }));
    } finally {
      setBusy((current) => ({ ...current, [school.id]: false }));
      await load();
    }
  };

  return (
    <main className="page">
      <h1>Schools</h1>
      {schools.map((school) => {
        const roster = summaries[school.id];
        const chosen = selected[school.id] ?? '';
        return (
          <section aria-label={school.name} key={school.id} className="child-section">
            <h2>{school.name}</h2>
            <p>
              <span className="label">Delivery weekday </span>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][school.delivery_weekday]}
            </p>
            <ul className="roster-summary" aria-label="Roster summary">
              {DELIVERY_STATUS_ORDER.map((status) => (
                <li key={status}>
                  <DeliveryStatusCell status={status} count={roster?.counts[status] ?? 0} />
                </li>
              ))}
            </ul>
            <p>
              <Link to={`/roster?school=${school.id}`}>View roster</Link>
            </p>
            <div className="field">
              <label htmlFor={`delivery-date-${school.id}`}>Delivery date</label>
              <select
                id={`delivery-date-${school.id}`}
                value={chosen}
                onChange={(event) => {
                  touched.current[school.id] = true;
                  selectedRef.current = { ...selectedRef.current, [school.id]: event.target.value };
                  setSelected((current) => ({ ...current, [school.id]: event.target.value }));
                  setStatuses((current) => ({ ...current, [school.id]: '' }));
                }}
              >
                <option value="">Pick a delivery day</option>
                {school.upcoming_delivery_days.map((day) => (
                  <option value={day.date} key={day.date}>
                    {`${formatStoreDate(day.date)} (cutoff ${formatStoreDateTime(day.cutoff_at)})`}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="primary"
              disabled={chosen === '' || busy[school.id] === true}
              onClick={() => void send(school)}
            >
              Send delivery notice
            </button>
            <p className="status" role="status" aria-label="Delivery notice status">
              {statuses[school.id] ?? ''}
            </p>
          </section>
        );
      })}
    </main>
  );
}
