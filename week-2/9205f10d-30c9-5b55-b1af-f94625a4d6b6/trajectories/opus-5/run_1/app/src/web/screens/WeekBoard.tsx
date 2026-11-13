import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { RequestView, SessionUser } from '../../shared/types.js';
import { api } from '../api.js';
import { usePolled } from '../hooks.js';
import { Link, useNavigation } from '../router.jsx';
import {
  SETTING_LABELS,
  STATUS_LABELS,
  agencyIsoDate,
  clock,
  isCancelled,
  labelForDate,
  shiftDays,
  weekMonday,
} from '../format.js';
import { StatusCell, confirmedSeatCount } from '../components/StatusCell.jsx';
import { JobDetail } from '../components/JobDetail.jsx';
import { NotFound } from './NotFound.jsx';

const BOARD_STATUSES = 'submitted,half-staffed,staffed,completed,invoiced,cancelled_early,cancelled_late';
const OPEN_STATUSES: readonly string[] = ['submitted', 'half-staffed'];

export function WeekBoard({
  user,
  pathJobId,
}: {
  user: SessionUser;
  pathJobId: string | null;
}): ReactNode {
  const { search, navigate } = useNavigation();
  const parameters = new URLSearchParams(search);
  const week = weekMonday(parameters.get('week') ?? agencyIsoDate(new Date()));
  const jobId = pathJobId ?? parameters.get('job');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const board = usePolled(
    () => api.requests(`?week=${week}&status=${BOARD_STATUSES}`),
    ['board', week],
  );
  const detail = usePolled(
    () => (jobId === null ? Promise.resolve(null) : api.request(jobId)),
    ['job', jobId ?? ''],
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftDays(week, index)),
    [week],
  );
  const requests = board.data?.requests ?? [];
  const visible = onlyOpen
    ? requests.filter((request) => OPEN_STATUSES.includes(request.status))
    : requests;
  const monday = labelForDate(week);

  const openJob = (request: RequestView): void => {
    navigate(`/board?week=${week}&job=${request.id}`);
  };

  const closeJob = (): void => {
    const previous = jobId;
    navigate(`/board?week=${week}`);
    if (previous !== null) {
      window.setTimeout(() => rowRefs.current.get(previous)?.focus(), 0);
    }
  };

  const scrollToDay = (day: string): void => {
    const element = scroller.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (element !== null && element !== undefined && scroller.current !== null) {
      scroller.current.scrollTo({ left: element.offsetLeft - scroller.current.offsetLeft });
    }
  };

  return (
    <main>
      <section className="region" aria-label="Week board">
        <div className="page row-between">
          <h1>{`Week of ${monday.monthDay}`}</h1>
          <div className="button-row">
            <button
              type="button"
              className="quiet"
              onClick={() => navigate(`/board?week=${shiftDays(week, -7)}`)}
            >
              Previous week
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => navigate(`/board?week=${shiftDays(week, 7)}`)}
            >
              Next week
            </button>
          </div>
        </div>
        <div className="page" style={{ paddingTop: 0 }}>
          <label className="choice">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(event) => setOnlyOpen(event.target.checked)}
            />
            Only jobs with an open seat
          </label>
        </div>
        <nav className="day-strip" aria-label="Days">
          {days.map((day) => (
            <Link
              key={day}
              to={`/board?week=${week}`}
              aria-label={`${labelForDate(day).weekday} ${labelForDate(day).monthDay}`}
              onClick={() => scrollToDay(day)}
            >
              {`${labelForDate(day).weekday} ${labelForDate(day).monthDay}`}
              <span>{`${openSeatCount(requests, day)} open`}</span>
            </Link>
          ))}
        </nav>
        <div className="board-frame">
          <div className="board-rail">
            <nav aria-label="Days">
              {days.map((day) => (
                <Link
                  key={day}
                  to={`/board?week=${week}`}
                  aria-label={`${labelForDate(day).weekday} ${labelForDate(day).monthDay}`}
                  onClick={() => scrollToDay(day)}
                >
                  {`${labelForDate(day).weekday} ${labelForDate(day).monthDay}`}
                  <span>{`${openSeatCount(requests, day)} open`}</span>
                </Link>
              ))}
            </nav>
          </div>
          <div className="board-scroller" ref={scroller}>
            {days.map((day) => {
              const label = labelForDate(day);
              const dayJobs = visible.filter((request) => agencyIsoDate(request.starts_at) === day);
              return (
                <section
                  key={day}
                  className="day-column"
                  data-day={day}
                  aria-label={`${label.weekday} ${label.monthDay}`}
                >
                  <h3>{`${label.weekday} ${label.monthDay}`}</h3>
                  {dayJobs.map((request) => (
                    <JobRow
                      key={request.id}
                      request={request}
                      onOpen={openJob}
                      register={(element) => {
                        if (element === null) rowRefs.current.delete(request.id);
                        else rowRefs.current.set(request.id, element);
                      }}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      </section>
      {jobId !== null && detail.data !== null ? (
        <JobDetail
          request={detail.data}
          user={user}
          onClose={closeJob}
          onChanged={() => {
            detail.refresh();
            board.refresh();
          }}
        />
      ) : null}
      {jobId !== null && detail.data === null && detail.error?.code === 'not_found' ? (
        <NotFound />
      ) : null}
    </main>
  );
}

function openSeatCount(requests: readonly RequestView[], day: string): number {
  return requests
    .filter((request) => agencyIsoDate(request.starts_at) === day)
    .reduce(
      (total, request) =>
        total +
        (OPEN_STATUSES.includes(request.status)
          ? request.seats.filter((seat) => seat.status === 'open').length
          : 0),
      0,
    );
}

function JobRow({
  request,
  onOpen,
  register,
}: {
  request: RequestView;
  onOpen: (request: RequestView) => void;
  register: (element: HTMLButtonElement | null) => void;
}): ReactNode {
  const organisation = request.organisation?.name ?? '';
  const name = `${request.reference}, ${clock(request.starts_at)}, ${organisation}, ${
    STATUS_LABELS[request.status]
  }, ${confirmedSeatCount(request)} of ${request.team_size} seats`;
  return (
    <button type="button" className="job-row" aria-label={name} ref={register} onClick={() => onOpen(request)}>
      <span className="job-row-lead">
        <span className="job-time">{clock(request.starts_at)}</span>
        <StatusCell request={request} />
      </span>
      <span className="job-row-rest">
        <span className={`reference${isCancelled(request.status) ? ' struck' : ''}`}>
          {request.reference}
        </span>
        <span className="facts">
          {` ${organisation} · ${SETTING_LABELS[request.setting]} · ${request.required_credential} · ${request.city}`}
        </span>
      </span>
    </button>
  );
}
