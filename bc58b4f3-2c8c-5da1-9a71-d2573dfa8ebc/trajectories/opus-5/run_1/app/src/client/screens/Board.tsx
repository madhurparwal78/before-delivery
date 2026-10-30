import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { LANGUAGES, SETTINGS, nameOf } from '../../shared/catalog';
import {
  DAY_START_MINUTE,
  MINUTES_IN_DAY_WINDOW,
  addCentralDays,
  centralDateKey,
  centralWeekStart,
  formatCentralDay,
  formatCentralFullDay,
  parseCentralDateKey,
} from '../../shared/centralTime';
import {
  loadCoverage,
  releaseAssignment,
  type CoverageAssignment,
  type CoverageLanguage,
} from '../lib/api';
import { AllCoveredMark, SeatLane, StatusLabel, allCovered, coveredCount } from '../components/Seats';
import { Drawer, LiveStatus } from '../components/Shell';
import { dayText, hoursMinutesNumeral, hoursMinutesText, rangeText } from '../lib/format';
import {
  useCountingNumerals,
  useNarrowViewport,
  usePolling,
  useSeatMotion,
  type LaneView,
  type SeatGroup,
} from '../lib/hooks';

const DAY_COUNT = 7;

function dayColumns(weekStart: Date): Date[] {
  return Array.from({ length: DAY_COUNT }, (_unused, index) => addCentralDays(weekStart, index));
}

function groupsOf(languages: CoverageLanguage[]): SeatGroup[] {
  return languages.flatMap((language) =>
    language.assignments.map((assignment) => ({
      key: assignment.number,
      seats: assignment.seats.map((seat) => ({
        seat: seat.seat,
        status: seat.status,
        initials: seat.interpreter_initials ?? null,
      })),
    })),
  );
}

function Capsule({
  assignment,
  lanes,
  onOpen,
}: {
  assignment: CoverageAssignment;
  lanes: LaneView[];
  onOpen: (number: string, trigger: HTMLButtonElement) => void;
}): ReactNode {
  const offset =
    ((minutesFromIso(assignment.start_at) - DAY_START_MINUTE) / MINUTES_IN_DAY_WINDOW) * 100;
  const width = (assignment.duration_minutes / MINUTES_IN_DAY_WINDOW) * 100;
  const label = `${assignment.number} ${rangeText(assignment.start_at, assignment.end_at)} ${coveredCount(lanes)}`;

  return (
    <button
      type="button"
      className="capsule"
      aria-label={label}
      style={{ left: `${offset}%`, width: `${width}%` }}
      onClick={(event) => onOpen(assignment.number, event.currentTarget)}
    >
      {lanes.map((lane) => (
        <SeatLane key={lane.seat} lane={lane} />
      ))}
      <span className={`capsule-foot${offset > 55 ? ' before' : ''}`}>
        <span className="numeral">{assignment.number}</span>
        <span>{coveredCount(lanes)}</span>
        {allCovered(lanes) ? <AllCoveredMark /> : null}
      </span>
    </button>
  );
}

function minutesFromIso(iso: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return DAY_START_MINUTE;
  return Number.parseInt(match[1] as string, 10) * 60 + Number.parseInt(match[2] as string, 10);
}

function CapsuleDetail({
  assignment,
  lanes,
  onClose,
  onReleased,
}: {
  assignment: CoverageAssignment;
  lanes: LaneView[];
  onClose: () => void;
  onReleased: () => void;
}): ReactNode {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <Drawer title={`Assignment ${assignment.number}`} onClose={onClose}>
      <dl className="detail-list">
        <dt>Status</dt>
        <dd>
          <StatusLabel status={assignment.status} />
        </dd>
        <dt>Organisation</dt>
        <dd>{assignment.org_code}</dd>
        <dt>Setting</dt>
        <dd>{nameOf(SETTINGS, assignment.setting)}</dd>
        <dt>When</dt>
        <dd>{rangeText(assignment.start_at, assignment.end_at)}</dd>
        <dt>Duration</dt>
        <dd>
          <span className="numeral">{assignment.duration_minutes}</span> min
        </dd>
      </dl>
      <h3>Seats</h3>
      <div className="card-lanes">
        {lanes.map((lane) => (
          <div className="card-lane-row" key={lane.seat}>
            <span>Seat {lane.seat}</span>
            <SeatLane lane={lane} />
          </div>
        ))}
      </div>
      <p>
        {coveredCount(lanes)} {allCovered(lanes) ? <AllCoveredMark /> : null}
      </p>
      {assignment.status === 'draft' ? (
        <button
          type="button"
          className="primary"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setStatus('Releasing…');
            releaseAssignment(assignment.number)
              .then((result) => {
                setStatus(
                  `Released. Offers going out to ${result.offers_sent} qualified interpreters.`,
                );
                onReleased();
              })
              .catch(() => setStatus('This request has already been released or closed.'))
              .finally(() => setPending(false));
          }}
        >
          Release to interpreters
        </button>
      ) : null}
      <LiveStatus name="Release status" message={status} />
    </Drawer>
  );
}

export function Board(): ReactNode {
  const [weekStart, setWeekStart] = useState(() => centralDateKey(centralWeekStart(new Date())));
  const [activeDay, setActiveDay] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { data, failing, refresh } = usePolling(() => loadCoverage(weekStart), [weekStart]);

  const languages = useMemo(() => data?.languages ?? [], [data]);
  const groups = useMemo(() => groupsOf(languages), [languages]);

  const languageOf = useCallback(
    (number: string): CoverageLanguage | undefined =>
      languages.find((language) =>
        language.assignments.some((assignment) => assignment.number === number),
      ),
    [languages],
  );

  const announce = useCallback(
    (number: string, seat: number, initials: string | null, covered: boolean) => {
      const language = languageOf(number);
      const assignment = language?.assignments.find((item) => item.number === number);
      if (language === undefined || assignment === undefined) return;
      const uncovered = hoursMinutesText(language.uncovered_minutes);
      setAnnouncement(
        covered
          ? `${language.name}, ${dayText(assignment.start_at)}: seat ${seat} covered by ${initials ?? ''}, ${uncovered} uncovered this week`
          : `${language.name}, ${dayText(assignment.start_at)}: seat ${seat} open, ${uncovered} uncovered this week`,
      );
    },
    [languageOf],
  );

  const { lanes, pending } = useSeatMotion(groups, {
    onCovered: (number, seat, initials) => announce(number, seat, initials, true),
    onReopened: (number, seat) => announce(number, seat, null, false),
  });

  const targets = useMemo(() => {
    const next: Record<string, number> = {};
    for (const language of languages) next[language.code] = language.uncovered_minutes;
    return next;
  }, [languages]);

  const frozen = useMemo(() => {
    const held = new Set<string>();
    for (const language of languages) {
      if (language.assignments.some((assignment) => pending.has(assignment.number))) {
        held.add(language.code);
      }
    }
    return held;
  }, [languages, pending]);

  const numerals = useCountingNumerals(targets, frozen);

  const weekStartDate = parseCentralDateKey(weekStart) ?? centralWeekStart(new Date());
  const days = dayColumns(weekStartDate);
  const narrow = useNarrowViewport();
  const visibleDays: Date[] = narrow ? days.slice(activeDay, activeDay + 1) : days;

  const shiftWeek = (deltaDays: number): void => {
    const shifted = addCentralDays(weekStartDate, deltaDays);
    setWeekStart(centralDateKey(shifted));
  };

  const currentAssignment = languages
    .flatMap((language) => language.assignments)
    .find((assignment) => assignment.number === open);

  return (
    <main className="sheet">
      <div className="week-bar">
        <h1>Week of {formatCentralFullDay(weekStartDate)}</h1>
        <p className="hint">Each day runs 06:00 to 22:00 Central.</p>
        <div className="row-actions">
          <button type="button" onClick={() => shiftWeek(-7)}>
            Previous week
          </button>
          <button type="button" onClick={() => shiftWeek(7)}>
            Next week
          </button>
        </div>
      </div>
      {narrow ? (
        <div role="tablist" aria-label="Days">
          {days.map((day, index) => (
            <button
              type="button"
              role="tab"
              key={centralDateKey(day)}
              id={`day-tab-${index}`}
              aria-selected={index === activeDay}
              tabIndex={index === activeDay ? 0 : -1}
              ref={(element) => {
                dayRefs.current[index] = element;
              }}
              onClick={() => setActiveDay(index)}
              onKeyDown={(event) => {
                const move = (to: number): void => {
                  const clamped = (to + DAY_COUNT) % DAY_COUNT;
                  setActiveDay(clamped);
                  dayRefs.current[clamped]?.focus();
                };
                if (event.key === 'ArrowRight') move(index + 1);
                if (event.key === 'ArrowLeft') move(index - 1);
                if (event.key === 'Home') move(0);
                if (event.key === 'End') move(DAY_COUNT - 1);
              }}
            >
              {formatCentralDay(day).split(' ').slice(0, 2).join(' ')}
            </button>
          ))}
        </div>
      ) : null}

      <section className="board" role="region" aria-label="Coverage board">
        <div className="board-head">
          <div className="board-gutter">
            <span className="board-language">Language</span>
          </div>
          <div className={`board-days${narrow ? ' single' : ''}`}>
            {visibleDays.map((day) => (
              <div className="board-day-label" key={centralDateKey(day)}>
                {formatCentralDay(day)}
              </div>
            ))}
          </div>
        </div>
        {LANGUAGES.map((entry) => {
          const language = languages.find((candidate) => candidate.code === entry.code);
          const minutes = numerals[entry.code] ?? language?.uncovered_minutes ?? 0;
          return (
            <div className="board-row" role="group" aria-label={entry.name} key={entry.code}>
              <div className="board-gutter">
                <span className="board-language">{entry.name}</span>
                <span className="uncovered">
                  <span role="group" aria-label={`${entry.name} uncovered`}>
                    <span className="numeral uncovered-value">{hoursMinutesNumeral(minutes)}</span>
                  </span>
                  <span aria-hidden="true">
                    h<span className="wide-only"> uncovered</span>
                  </span>
                </span>
              </div>
              <div className={`board-days${narrow ? ' single' : ''}`}>
                {visibleDays.map((day) => {
                  const key = centralDateKey(day);
                  const forDay = (language?.assignments ?? []).filter(
                    (assignment) => centralDateKey(new Date(assignment.start_at)) === key,
                  );
                  return (
                    <div className="board-day" key={key}>
                      {forDay.map((assignment) => (
                        <Capsule
                          key={assignment.number}
                          assignment={assignment}
                          lanes={lanes.get(assignment.number) ?? []}
                          onOpen={(number, trigger) => {
                            opener.current = trigger;
                            setOpen(number);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
      <LiveStatus
        name="Board updates"
        message={failing ? 'Board not updating. Retrying…' : announcement}
      />
      {currentAssignment === undefined ? null : (
        <CapsuleDetail
          assignment={currentAssignment}
          lanes={lanes.get(currentAssignment.number) ?? []}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
          onReleased={refresh}
        />
      )}
    </main>
  );
}
