import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditPage, Clock } from '../api.js';
import { call } from '../guard.js';
import { officeStamp } from '../format.js';
import { go, useLocation } from '../router.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function Audit(props: { clock: Clock }): React.ReactElement {
  const where = useLocation();
  const given = where.query.get('day');
  const day = given !== null && DAY.test(given) ? given : props.clock.office_date;
  const [entries, setEntries] = useState<AuditPage['entries']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstNewRow = useRef<HTMLTableRowElement | null>(null);
  const focusAfterPage = useRef(false);

  useEffect(() => {
    if (given === null || !DAY.test(given)) {
      window.history.replaceState(null, '', `/audit?day=${day}`);
    }
  }, [given, day]);

  const loadFirst = useCallback(() => {
    let current = true;
    void call<AuditPage>(`/api/audit?day=${day}&order=oldest&limit=50`)
      .then((page) => {
        if (!current) return;
        setEntries(page.entries);
        setCursor(page.next_cursor);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [day]);

  useEffect(loadFirst, [loadFirst]);

  const more = async (): Promise<void> => {
    if (pending || cursor === null) return;
    setPending(true);
    try {
      const page = await call<AuditPage>(
        `/api/audit?day=${day}&order=oldest&limit=50&after=${encodeURIComponent(cursor)}`,
      );
      focusAfterPage.current = true;
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.next_cursor);
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (focusAfterPage.current && firstNewRow.current !== null) {
      focusAfterPage.current = false;
      firstNewRow.current.focus();
    }
  }, [entries]);

  const pageStart = Math.floor(Math.max(0, entries.length - 1) / 50) * 50;

  return (
    <main>
      <h1>Audit trail</h1>
      <p>
        <label htmlFor="audit-day">Office day</label>
        <input
          id="audit-day"
          type="date"
          value={day}
          onChange={(event) => {
            if (DAY.test(event.target.value)) go(`/audit?day=${event.target.value}`);
          }}
        />
      </p>
      <div className="audit-sheet">
        <table>
          <caption className="hidden-live">Audit entries</caption>
          <thead>
            <tr>
              <th scope="col">Office time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Subject</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr
                key={entry.id}
                tabIndex={-1}
                ref={(node) => {
                  if (index === pageStart && pageStart > 0) firstNewRow.current = node;
                }}
              >
                <td className="stamp">{officeStamp(entry.office_day, entry.office_time, entry.offset)}</td>
                <td>{'system' in entry.actor ? entry.actor.system : entry.actor.name}</td>
                <td>{entry.action}</td>
                <td>{entry.subject.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor === null ? null : (
        <button type="button" onClick={() => void more()}>
          {pending ? 'Loading' : 'More entries'}
        </button>
      )}
    </main>
  );
}
