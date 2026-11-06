import { useCallback, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { NetworkError, api } from "../api";
import { Drawer } from "../components/Drawer";
import { ChevronLeft, ChevronRight, CoveredCheck } from "../components/Icons";
import { SeatLane } from "../components/SeatLane";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { coveredCount } from "../labels";
import { usePolling } from "../poll";
import { type SeamChange, laneLabel, laneSnapshot, useHatchSeam } from "../seam";
import {
  AGENCY_ZONE,
  agencyDate,
  agencyMonday,
  clockText,
  formatDay,
  formatLongDate,
  formatRange,
  formatTabDay,
  hoursAndMinutes,
  minutesIntoAgencyDay,
  shiftDate,
} from "../../shared/time";
import type { Assignment, Coverage, CoverageAssignment } from "../types";
import { AssignmentDetail } from "./AssignmentDetail";

const DAY_START = 6 * 60;
const HOURS = Array.from({ length: 15 }, (_, i) => i + 1);
const SCALE: ReadonlyArray<[string, string]> = [
  ["06", "0%"],
  ["10", "25%"],
  ["14", "50%"],
  ["18", "75%"],
];

/** Pack the row's capsules into tracks so capsules that overlap in time never cover each other. */
function tracksOf(assignments: CoverageAssignment[]): Map<string, number> {
  const tracks = new Map<string, number>();
  const ends: Record<string, number[]> = {};
  for (const a of [...assignments].sort((x, y) => x.start_at.localeCompare(y.start_at))) {
    const day = agencyDate(a.start_at);
    const start = Date.parse(a.start_at);
    const dayEnds = (ends[day] ??= []);
    let track = dayEnds.findIndex((end) => end <= start);
    if (track < 0) track = dayEnds.length;
    dayEnds[track] = Date.parse(a.end_at);
    tracks.set(a.number, track);
  }
  return tracks;
}


function announcement(coverage: Coverage, changes: SeamChange[]): string {
  return changes
    .map((change) => {
      const [number, seatText] = change.key.split("#");
      const language = coverage.languages.find((l) => l.assignments.some((a) => a.number === number));
      const assignment = language?.assignments.find((a) => a.number === number);
      if (!language || !assignment) return "";
      const seat = assignment.seats.find((s) => String(s.seat) === seatText);
      const where = `${language.name}, ${formatDay(assignment.start_at)}: seat ${seatText}`;
      const left = `${hoursAndMinutes(language.uncovered_minutes)} uncovered this week`;
      return change.toHeld ? `${where} covered by ${seat?.interpreter_initials ?? ""}, ${left}` : `${where} open, ${left}`;
    })
    .filter(Boolean)
    .join(" ");
}

function initialWeek(): string {
  return agencyMonday(DateTime.now().setZone(AGENCY_ZONE));
}

function initialDay(week: string): string {
  const today = DateTime.now().setZone(AGENCY_ZONE).toISODate() ?? week;
  return today >= week && today <= shiftDate(week, 6) ? today : week;
}

export function Board() {
  const [week, setWeek] = useState(initialWeek);
  const [day, setDay] = useState(() => initialDay(initialWeek()));
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [updates, setUpdates] = useState<StatusMessage>(quiet);
  const [open, setOpen] = useState<Assignment | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(week, i)), [week]);

  const load = useCallback(async () => {
    const failed: StatusMessage = { tone: "error", text: "Board not updating. Retrying…" };
    try {
      const result = await api<Coverage>("GET", `/api/coverage?week=${week}`);
      if (!result.ok) {
        setUpdates(failed);
        return;
      }
      setCoverage(result.data.week_start === week ? result.data : null);
      setUpdates((current) => (current.tone === "error" ? quiet : current));
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setUpdates(failed);
    }
  }, [week]);
  usePolling(load, [load]);

  const snapshot = useMemo(
    () =>
      coverage
        ? laneSnapshot(
            coverage.languages.flatMap((l) => l.assignments),
            new Map(coverage.languages.map((l) => [l.code, l.uncovered_minutes])),
          )
        : null,
    [coverage],
  );
  const seam = useHatchSeam(snapshot, week, (changes) => {
    if (coverage) setUpdates({ tone: "neutral", text: announcement(coverage, changes) });
  });

  const shown = coverage?.languages.flatMap((l) => l.assignments) ?? [];
  const weekHasWork = shown.length > 0;
  const dayHasWork = shown.some((a) => agencyDate(a.start_at) === day);

  const moveWeek = (weeks: number) => {
    const next = shiftDate(week, weeks * 7);
    setCoverage(null);
    setWeek(next);
    setDay(initialDay(next));
  };

  const openAssignment = async (number: string, element: HTMLElement) => {
    opener.current = element;
    const result = await api<Assignment>("GET", `/api/assignments/${number}`).catch(() => null);
    if (result?.ok) setOpen(result.data);
  };

  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: 6 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + 7) % 7;
    setDay(days[next] ?? week);
    tabs.current[next]?.focus();
  };

  const renderCapsule = (a: CoverageAssignment, track: number) => {
    const covered = seam.covered(a.number, coveredCount(a.seats));
    const countText = `${covered} of ${a.seats.length} covered`;
    const style = {
      "--start": minutesIntoAgencyDay(a.start_at) - DAY_START,
      "--length": a.duration_minutes,
      "--row": track,
    } as React.CSSProperties;
    return (
      <button
        key={a.number}
        type="button"
        className={`capsule ${open?.number === a.number ? "capsule-open" : ""}`}
        style={style}
        aria-label={`${a.number}, ${formatRange(a.start_at, a.end_at)}, ${countText}`}
        onClick={(event) => void openAssignment(a.number, event.currentTarget)}
      >
        <span className="capsule-lanes">
          {a.seats.map((seat) => {
            const key = `${a.number}#${seat.seat}`;
            const actual = { held: seat.status !== "open", label: laneLabel(seat) };
            return <SeatLane key={key} seat={seat.seat} shown={seam.lane(key, actual)} fillRef={seam.fillRef(key)} />;
          })}
        </span>
        <span className="capsule-meta">
          <span className="num">{a.number}</span>
          <span className="capsule-count num">{countText}</span>
          {covered === a.seats.length ? <CoveredCheck /> : null}
        </span>
      </button>
    );
  };

  return (
    <section className="board" role="region" aria-label="Coverage board">
      <div className="board-head">
        <h2>Week of {formatLongDate(week)}</h2>
        <div className="week-nav">
          <button type="button" className="button" onClick={() => moveWeek(-1)}>
            <ChevronLeft />
            Previous week
          </button>
          <button type="button" className="button" onClick={() => moveWeek(1)}>
            Next week
            <ChevronRight />
          </button>
        </div>
        <Status name="Board updates" message={updates} className="board-updates" />
      </div>

      <div className="day-tabs" role="tablist" aria-label="Days">
        {days.map((d, index) => (
          <button
            key={d}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`day-tab-${d}`}
            aria-selected={d === day}
            aria-controls="board-sheet"
            tabIndex={d === day ? 0 : -1}
            className="day-tab"
            onClick={() => setDay(d)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <span className="day-tab-text">{formatTabDay(d)}</span>
          </button>
        ))}
      </div>

      {coverage && !weekHasWork ? <p className="board-empty">No requests in this week.</p> : null}
      {coverage && weekHasWork && !dayHasWork ? (
        <p className="board-empty board-empty-day">No requests on {formatTabDay(day)}.</p>
      ) : null}

      <div className="sheet" id="board-sheet" data-loading={coverage ? undefined : "true"}>
        <div className="sheet-row sheet-header" aria-hidden="true">
          <div className="gutter gutter-head">
            <span className="gutter-label">Language</span>
            <span className="muted">
              <span className="gutter-label">uncovered </span>h:mm
            </span>
          </div>
          <div className="days">
            {days.map((d) => (
              <div key={d} className={`day-head ${d === day ? "day-selected" : ""}`}>
                <span className="day-name">{formatTabDay(d)}</span>
                <span className="day-scale num">
                  {SCALE.map(([label, at]) => (
                    <span key={label} style={{ "--at": at } as React.CSSProperties}>
                      {label}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
        {(coverage?.languages ?? []).map((language) => {
          const tracks = tracksOf(language.assignments);
          const rows = Math.max(1, ...[...tracks.values()].map((t) => t + 1));
          const minutes = seam.numeral(language.code, language.uncovered_minutes);
          return (
            <div key={language.code} role="group" aria-label={language.name} className="sheet-row lang-row" style={{ "--tracks": rows } as React.CSSProperties}>
              <div className="gutter">
                <span className="lang-name">{language.name}</span>
                <span className={`lang-uncovered ${language.uncovered_minutes > 0 ? "has-gap" : ""}`}>
                  <span role="group" aria-label={`${language.name} uncovered`} className="numeral num">
                    {clockText(minutes)}
                  </span>
                  <span className="unit">h</span>
                </span>
              </div>
              <div className="days">
                {days.map((d) => (
                  <div key={d} className={`day-cell ${d === day ? "day-selected" : ""}`}>
                    <svg className="hour-rules" viewBox="0 0 16 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                      {HOURS.map((h) => (
                        <line key={h} x1={h} x2={h} y1={0} y2={1} vectorEffect="non-scaling-stroke" className={h % 4 === 0 ? "rule-strong" : undefined} />
                      ))}
                    </svg>
                    {language.assignments
                      .filter((a) => agencyDate(a.start_at) === d)
                      .map((a) => renderCapsule(a, tracks.get(a.number) ?? 0))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {coverage === null ? <div className="sheet-loading" aria-hidden="true" /> : null}
      </div>

      {open ? (
        <Drawer
          title={`Assignment ${open.number}`}
          contentKey={open.number}
          onClosed={() => {
            setOpen(null);
            opener.current?.focus({ preventScroll: true });
          }}
        >
          <AssignmentDetail
            assignment={open}
            role="dispatcher"
            onChanged={(changed) => {
              setOpen(changed);
              void load();
            }}
          />
        </Drawer>
      ) : null}
    </section>
  );
}
