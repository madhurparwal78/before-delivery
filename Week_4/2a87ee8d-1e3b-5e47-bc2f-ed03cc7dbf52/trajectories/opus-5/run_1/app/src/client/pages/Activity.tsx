import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { displayDate, displayTime } from '../lib/format.js';
import {
  ACTIVITY_LABELS,
  STATUS_LABELS,
  type ActivityEntry,
  type Facilitator,
  type FacilitatorWorkshop,
} from '../../shared/protocol.js';

interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly nextCursor: string | null;
}

export function Activity(): JSX.Element {
  const { navigate } = useRouter();
  const [entries, setEntries] = useState<readonly ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [statuses, setStatuses] = useState<ReadonlyMap<string, string>>(new Map());
  const [timeZone, setTimeZone] = useState('UTC');
  const firstNewEntry = useRef<HTMLLIElement>(null);
  const appendedFrom = useRef(0);

  const load = useCallback(
    async (from: string | null) => {
      try {
        const page = await api<ActivityPage>(
          'GET',
          from === null ? '/api/activity' : `/api/activity?cursor=${encodeURIComponent(from)}`,
        );
        appendedFrom.current = from === null ? -1 : entries.length;
        setEntries((current) => (from === null ? page.entries : [...current, ...page.entries]));
        setCursor(page.nextCursor);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) navigate('/signin');
      }
    },
    [entries.length, navigate],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [session, list] = await Promise.all([
          api<{ facilitator: Facilitator }>('GET', '/api/session'),
          api<{ workshops: FacilitatorWorkshop[] }>('GET', '/api/workshops'),
        ]);
        setTimeZone(session.facilitator.timeZone);
        setTitles(new Map(list.workshops.map((workshop) => [workshop.id, workshop.title])));
        setStatuses(
          new Map(list.workshops.map((workshop) => [workshop.id, STATUS_LABELS[workshop.status]])),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) navigate('/signin');
      }
    })();
    void load(null);
    // The first page loads once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Load more" keeps focus on the first newly added entry.
  useEffect(() => {
    if (appendedFrom.current > 0) firstNewEntry.current?.focus();
  }, [entries]);

  return (
    <main className="column activity">
      <h1>Activity log</h1>
      <ul className="rule-list" aria-label="Activity">
        {entries.map((entry, index) => {
          const at = Date.parse(entry.at);
          const title = entry.workshopId === null ? null : titles.get(entry.workshopId);
          // The transitioned label names the status the workshop moved to.
          const label =
            entry.action === 'workshop.transitioned'
              ? `Moved to ${entry.workshopId === null ? '' : (statuses.get(entry.workshopId) ?? '')}`.trim()
              : (ACTIVITY_LABELS[entry.action] ?? entry.action);
          return (
            <li
              key={entry.id}
              tabIndex={-1}
              ref={index === appendedFrom.current ? firstNewEntry : null}
            >
              <span className="mono">
                {displayDate(at, timeZone)}, {displayTime(at, timeZone)}
              </span>
              {' — '}
              {label}
              {title === undefined || title === null ? '' : ` — ${title}`}
            </li>
          );
        })}
      </ul>
      {cursor !== null && (
        <button type="button" onClick={() => void load(cursor)}>
          Load more
        </button>
      )}
    </main>
  );
}
