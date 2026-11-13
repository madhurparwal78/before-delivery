import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, agencyDate, weekMonday } from "../../shared/agencyTime";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api } from "./api";
import { CANCELLED, STATUS_LABEL, agencyDateOf, clockOf, confirmedCount, dayLabel, monthDayOf, SETTING_LABEL } from "./format";
import { JobPane, usePane } from "./JobPane";
import { REFRESH_MS, reducedMotion, useInterval } from "./motion";
import { NotFound } from "./NotFound";
import { navigate, usePlace } from "./router";
import { StatusMark } from "./StatusMark";
import type { ApiRequest, User } from "./types";

const BOARD_STATUSES = "submitted,half-staffed,staffed,completed,invoiced,cancelled_early,cancelled_late";
const HAS_OPEN_SEAT = ["submitted", "half-staffed"];

const openSeatsOf = (r: ApiRequest): number => (HAS_OPEN_SEAT.includes(r.status) ? r.seats.length - confirmedCount(r) : 0);

function rowName(r: ApiRequest): string {
  return `${r.reference}, ${clockOf(r.starts_at)}, ${r.organisation?.name ?? ""}, ${STATUS_LABEL[r.status]}, ${confirmedCount(r)} of ${r.team_size ?? r.seats.length} seats`;
}

function JobRow({ request, onOpen }: { request: ApiRequest; onOpen: (r: ApiRequest, row: HTMLButtonElement) => void }) {
  const cancelled = CANCELLED.includes(request.status);
  return (
    <button
      type="button"
      className={`job-row job-row--${request.status}`}
      data-request-id={request.id}
      aria-label={rowName(request)}
      onClick={(event) => onOpen(request, event.currentTarget)}
    >
      {/* The row's spoken name is the brief's summary; its visible facts (kind, city) sit outside it. */}
      <span className="job-time" aria-hidden="true">{clockOf(request.starts_at)}</span>
      <span className="job-status" aria-hidden="true">
        <StatusMark request={request} />
      </span>
      <span className="job-facts" aria-hidden="true">
        <span className={`job-ref num${cancelled ? " struck" : ""}`}>{request.reference}</span>
        <span className="job-org">{request.organisation?.name}</span>
        <span className="job-kind">
          {SETTING_LABEL[request.setting]} · {request.required_credential}
        </span>
        <span className="job-city">{request.city}</span>
      </span>
    </button>
  );
}

export function Board({ viewer }: { viewer: User }) {
  const place = usePlace();
  const requested = place.query.get("week");
  const week = weekMonday(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : agencyDate(new Date()));
  const jobId = place.query.get("job");
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const [requests, setRequests] = useState<ApiRequest[] | null>(null);
  const [problem, setProblem] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [pane, exited] = usePane(jobId);
  const scroller = useRef<HTMLDivElement>(null);
  const opener = useRef<{ id: string; focus: boolean } | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ requests: ApiRequest[] }>("GET", `/api/requests?week=${week}&status=${BOARD_STATUSES}`);
    if (result.ok) {
      setRequests(result.data.requests);
      setProblem("");
    } else setProblem(result.error?.message ?? OFFLINE_COPY);
  }, [week]);

  useEffect(() => {
    setRequests(null);
    void load();
  }, [load]);

  // The current week opens on today's column, so a dispatcher starts from today.
  const today = agencyDate(new Date());
  const loaded = requests !== null;
  useEffect(() => {
    const column = document.getElementById(`day-${today}`);
    const box = scroller.current;
    if (loaded && column && box) box.scrollLeft = column.offsetLeft;
  }, [loaded, week, today]);
  // An open pane brings its job's day to the scroller's leading edge, beside the pane.
  const paneId = pane?.id;
  useEffect(() => {
    const column = document.querySelector<HTMLElement>(`[data-request-id="${paneId}"]`)?.closest<HTMLElement>(".day-column");
    const box = scroller.current;
    if (loaded && column && box) box.scrollLeft = column.offsetLeft;
  }, [loaded, paneId]);
  useInterval(() => void load(), REFRESH_MS);

  const boardUrl = (job: string | null) => `/board?week=${week}${job ? `&job=${job}` : ""}`;

  const open = (request: ApiRequest, row: HTMLButtonElement) => {
    opener.current = { id: request.id, focus: true };
    row.blur();
    navigate(boardUrl(request.id));
  };
  const close = useCallback(() => {
    navigate(`/board?week=${week}`);
    const id = opener.current?.id ?? jobId;
    opener.current = null;
    document.querySelector<HTMLButtonElement>(`[data-request-id="${id}"]`)?.focus();
  }, [week, jobId]);

  const moveWeek = (days: number) => navigate(`/board?week=${addDays(week, days)}`);

  const showDay = (day: string) => {
    const column = document.getElementById(`day-${day}`);
    const box = scroller.current;
    if (!column || !box) return;
    box.scrollTo({ left: column.offsetLeft, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  if (missing && missing === jobId) return <NotFound />;

  const byDay = (day: string) =>
    (requests ?? []).filter((r) => agencyDateOf(r.starts_at) === day && (!onlyOpen || HAS_OPEN_SEAT.includes(r.status)));

  return (
    <div className={`board-page${pane ? " board-page--pane" : ""}`}>
      <section className="board" aria-label="Week board">
        <div className="board-rail">
          <h1>Week of {monthDayOf(week)}</h1>
          <div className="week-buttons">
            <button type="button" className="button" onClick={() => moveWeek(-7)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Previous week
            </button>
            <button type="button" className="button" onClick={() => moveWeek(7)}>
              Next week
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            <span>Only jobs with an open seat</span>
          </label>
          <nav className="day-strip" aria-label="Days">
            <ul>
              {days.map((day) => {
                const openCount = (requests ?? []).filter((r) => agencyDateOf(r.starts_at) === day).reduce((n, r) => n + openSeatsOf(r), 0);
                return (
                  <li key={day}>
                    <a
                      href={`#day-${day}`}
                      className={`day-link${openCount > 0 ? " day-link--open" : ""}`}
                      aria-current={day === today ? "date" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        showDay(day);
                      }}
                    >
                      <span className="day-name">{dayLabel(day)}</span>
                      <span className="day-count num">{openCount} open</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <div className="board-days" ref={scroller}>
          {days.map((day) => {
            const rows = byDay(day);
            return (
              <section key={day} id={`day-${day}`} className="day-column" aria-label={dayLabel(day)}>
                <h2 className="day-heading">{dayLabel(day)}</h2>
                {requests === null ? (
                  <Placeholder rows={2} />
                ) : rows.length === 0 ? (
                  <p className="empty">{onlyOpen ? "No open seats this day." : "No jobs this day."}</p>
                ) : (
                  rows.map((request) => <JobRow key={request.id} request={request} onOpen={open} />)
                )}
              </section>
            );
          })}
        </div>
        {problem && (
          <p className="banner banner--alert" role="status">
            {problem}
          </p>
        )}
      </section>
      {pane && (
        <JobPane
          key={pane.id}
          pane={pane}
          viewer={viewer}
          initial={requests?.find((r) => r.id === pane.id)}
          openedByUser={opener.current?.focus ?? false}
          onClose={close}
          onExited={exited}
          onMissing={() => setMissing(pane.id)}
        />
      )}
    </div>
  );
}
