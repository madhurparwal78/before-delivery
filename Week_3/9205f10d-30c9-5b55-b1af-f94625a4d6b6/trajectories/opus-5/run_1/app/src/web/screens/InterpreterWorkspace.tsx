import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SeatOnRequest, SessionUser } from '../../shared/types.js';
import { api } from '../api.js';
import { usePolled } from '../hooks.js';
import { Link, useNavigation } from '../router.jsx';
import { SETTING_LABELS, monthDay, timeWindow, weekday } from '../format.js';
import { JobDetail } from '../components/JobDetail.jsx';
import { NotFound } from './NotFound.jsx';

type ListMode = 'open-seats' | 'assignments';

const LIST_LABEL: Record<ListMode, string> = {
  'open-seats': 'Open seats',
  assignments: 'My assignments',
};

const LIST_PATH: Record<ListMode, string> = {
  'open-seats': '/open-seats',
  assignments: '/assignments',
};

function seatLine(entry: SeatOnRequest): string {
  const { request } = entry;
  return `${SETTING_LABELS[request.setting]} · ${request.required_credential} · ${weekday(
    request.starts_at,
  )}, ${monthDay(request.starts_at)} · ${timeWindow(request.starts_at, request.ends_at)} · ${
    request.city
  } · Seat ${entry.seat_label}`;
}

export function InterpreterWorkspace({ user }: { user: SessionUser }): ReactNode {
  const { pathname, navigate } = useNavigation();
  const jobMatch = /^\/jobs\/(.+)$/.exec(pathname);
  const jobId = jobMatch === null ? null : (jobMatch[1] as string);
  const [mode, setMode] = useState<ListMode>(
    pathname === '/assignments' ? 'assignments' : 'open-seats',
  );
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    if (pathname === '/assignments') setMode('assignments');
    if (pathname === '/open-seats') setMode('open-seats');
  }, [pathname]);

  const list = usePolled<SeatOnRequest[]>(
    async () =>
      mode === 'open-seats'
        ? (await api.openSeats()).open_seats
        : (await api.assignments()).assignments,
    [mode],
  );
  const detail = usePolled(
    () => (jobId === null ? Promise.resolve(null) : api.request(jobId)),
    ['job', jobId ?? ''],
  );

  const closeJob = (): void => {
    const previous = jobId;
    navigate(LIST_PATH[mode]);
    if (previous !== null) window.setTimeout(() => linkRefs.current.get(previous)?.focus(), 0);
  };

  const entries = list.data ?? [];

  return (
    <main className="page seat-list-page">
      <h1>{LIST_LABEL[mode]}</h1>
      <ul className="card-list" aria-label={LIST_LABEL[mode]}>
        {entries.map((entry) => (
          <li key={entry.seat_id}>
            <Link
              to={`/jobs/${entry.request.id}`}
              aria-label={`View job ${entry.request.reference}`}
              ref={(element) => {
                if (element === null) linkRefs.current.delete(entry.request.id);
                else linkRefs.current.set(entry.request.id, element);
              }}
            >
              {seatLine(entry)}
            </Link>
          </li>
        ))}
      </ul>
      {list.data !== null && entries.length === 0 ? (
        <p className="empty">
          {mode === 'open-seats'
            ? 'No seats are open to you right now.'
            : 'You hold no confirmed seats right now.'}
        </p>
      ) : null}
      {jobId !== null && detail.data !== null ? (
        <JobDetail
          request={detail.data}
          user={user}
          onClose={closeJob}
          onChanged={() => {
            detail.refresh();
            list.refresh();
          }}
        />
      ) : null}
      {jobId !== null && detail.data === null && detail.error?.code === 'not_found' ? (
        <NotFound />
      ) : null}
    </main>
  );
}
