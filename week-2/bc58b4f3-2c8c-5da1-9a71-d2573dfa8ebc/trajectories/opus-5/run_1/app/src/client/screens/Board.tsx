import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { CoverageAssignment, SessionUser } from '../../shared/contract.js';
import {
  DAY_COLUMN_END_MINUTE,
  DAY_COLUMN_START_MINUTE,
  agencyDateString,
  agencyMinuteOfDay,
  formatAgencyDate,
  formatAgencyDateWithYear,
  formatAgencyDayTab,
  formatAgencyRange,
  instantOf,
  parseDateString,
  startOfAgencyWeek,
} from '../../shared/zone.js';
import { api } from '../api.js';
import { AssignmentDrawer } from '../components/AssignmentDrawer.js';
import { usePoll, useViewportBelow } from '../hooks.js';
import { useHatchSeam, type SeamSnapshot } from '../seam.js';
import {
  SeatLane,
  StatusRegion,
  UncoveredNumeral,
  coveredCountOf,
  coveredCountText,
  seatLabelOf,
} from '../ui.js';

const DAY_SPAN_MINUTES = DAY_COLUMN_END_MINUTE - DAY_COLUMN_START_MINUTE;

function shiftWeek(weekStart: string, days: number): string {
  const date = parseDateString(weekStart);
  if (date === null) {
    throw new Error(`bad week start ${weekStart}`);
  }
  return agencyDateString(instantOf(date.year, date.month, date.day + days, 0, 0));
}

function dayInstants(weekStart: string): Date[] {
  const date = parseDateString(weekStart);
  if (date === null) {
    throw new Error(`bad week start ${weekStart}`);
  }
  return [0, 1, 2, 3, 4, 5, 6].map((offset) =>
    instantOf(date.year, date.month, date.day + offset, 12, 0),
  );
}

export function Board({ user }: { user: SessionUser }): ReactNode {
  const [weekStart, setWeekStart] = useState(() => agencyDateString(startOfAgencyWeek(new Date())));
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const singleDay = useViewportBelow(1024);
  const coverage = usePoll(() => api.coverage(weekStart), weekStart);
  const opened = usePoll(
    async () => (openNumber === null ? null : api.assignment(openNumber)),
    openNumber ?? '',
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const days = useMemo(() => dayInstants(weekStart), [weekStart]);
  const languages = coverage.data?.languages ?? [];

  const snapshot = useMemo<SeamSnapshot | null>(() => {
    if (coverage.data === null) {
      return null;
    }
    const seats = languages.flatMap((language) =>
      language.assignments.flatMap((assignment) =>
        assignment.seats.map((seat) => ({
          key: `${assignment.number}:${seat.seat}`,
          held: seat.status !== 'open',
          label: seatLabelOf(seat),
          groupKey: language.code,
          capsuleKey: assignment.number,
          announceSubject: `${language.name}, ${formatAgencyDate(new Date(assignment.start_at))}: seat ${seat.seat}`,
        })),
      ),
    );
    return {
      seats,
      groups: languages.map((language) => ({
        key: language.code,
        uncoveredMinutes: language.uncovered_minutes,
      })),
      capsules: languages.flatMap((language) =>
        language.assignments.map((assignment) => ({
          key: assignment.number,
          covered: coveredCountOf(assignment.seats),
          seats: assignment.seats.length,
        })),
      ),
    };
  }, [coverage.data]);

  const { display, announcement } = useHatchSeam(snapshot);
  const boardStatus = coverage.failed ? 'Board not updating. Retrying…' : announcement;
  const visibleDays = singleDay ? [selectedDay] : [0, 1, 2, 3, 4, 5, 6];

  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const moves: Record<string, number | undefined> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: 6,
    };
    const next = moves[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const clamped = Math.max(0, Math.min(6, next));
    setSelectedDay(clamped);
    tabRefs.current[clamped]?.focus();
  };

  return (
    <main className="sheet sheet--plain">
      <section className="board" aria-label="Coverage board">
        <div className="board__head">
          <h1>Week of {formatAgencyDateWithYear(days[0] ?? new Date())}</h1>
          <button type="button" className="btn btn--quiet" onClick={() => setWeekStart(shiftWeek(weekStart, -7))}>
            Previous week
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setWeekStart(shiftWeek(weekStart, 7))}>
            Next week
          </button>
        </div>

        {singleDay ? (
          <div className="daytabs" role="tablist" aria-label="Days">
            {days.map((day, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                className="daytab"
                aria-selected={selectedDay === index}
                tabIndex={selectedDay === index ? 0 : -1}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                onClick={() => setSelectedDay(index)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {formatAgencyDayTab(day)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="board__scale">
          <div className="board__scale-gutter">Language</div>
          <div
            className="board__scale-days"
            style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}
          >
            {visibleDays.map((index) => (
              <div key={index} className="board__scale-day">
                <span>{formatAgencyDayTab(days[index] ?? new Date())}</span>
                <span className="num">06:00–22:00</span>
              </div>
            ))}
          </div>
        </div>

        {languages.map((language) => (
          <div className="board__row" key={language.code} role="group" aria-label={language.name}>
            <div className="board__gutter">
              <span className="board__language">{language.name}</span>
              <span role="group" aria-label={`${language.name} uncovered`}>
                <UncoveredNumeral minutes={display.uncovered[language.code] ?? language.uncovered_minutes} />
              </span>
            </div>
            <div
              className="board__days"
              style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}
            >
              {visibleDays.map((dayIndex) => {
                const dayDate = agencyDateString(days[dayIndex] ?? new Date());
                const forDay = language.assignments.filter(
                  (assignment) => agencyDateString(new Date(assignment.start_at)) === dayDate,
                );
                return (
                  <div className="board__day" key={dayIndex}>
                    {forDay.map((assignment) => (
                      <Capsule
                        key={assignment.number}
                        assignment={assignment}
                        display={display}
                        onOpen={() => setOpenNumber(assignment.number)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <StatusRegion name="Board updates" text={boardStatus} />

      {opened.data === null || openNumber === null ? null : (
        <AssignmentDrawer
          assignment={opened.data}
          role={user.role}
          onClose={() => setOpenNumber(null)}
          onChanged={() => {
            void coverage.refresh();
            void opened.refresh();
          }}
        />
      )}
    </main>
  );
}

function Capsule({
  assignment,
  display,
  onOpen,
}: {
  assignment: CoverageAssignment;
  display: ReturnType<typeof useHatchSeam>['display'];
  onOpen: () => void;
}): ReactNode {
  const start = new Date(assignment.start_at);
  const startMinute = agencyMinuteOfDay(start);
  const left = ((startMinute - DAY_COLUMN_START_MINUTE) / DAY_SPAN_MINUTES) * 100;
  const width = (assignment.duration_minutes / DAY_SPAN_MINUTES) * 100;
  const covered = display.covered[assignment.number] ?? coveredCountOf(assignment.seats);
  const countText = coveredCountText(covered, assignment.seats.length);
  const range = formatAgencyRange(start, new Date(assignment.end_at));
  const allCovered = covered === assignment.seats.length;

  return (
    <div className="capsule" style={{ left: `${left}%`, width: `${width}%` }}>
      <div className="capsule__lanes">
        {assignment.seats.map((seat) => (
          <SeatLane
            key={seat.seat}
            seat={seat.seat}
            fill={display.fill[`${assignment.number}:${seat.seat}`] ?? 0}
            label={display.label[`${assignment.number}:${seat.seat}`] ?? 'open'}
            animating={display.animating[`${assignment.number}:${seat.seat}`] ?? false}
          />
        ))}
      </div>
      <div className="capsule__foot">
        <span className="capsule__number">{assignment.number}</span>
        {allCovered ? (
          <span className="capsule__check" role="img" aria-label="All seats covered">
            ✓
          </span>
        ) : null}
        <span>{countText}</span>
      </div>
      <button
        type="button"
        className="capsule__hit"
        aria-label={`${assignment.number} ${range} ${countText}`}
        onClick={onOpen}
      />
    </div>
  );
}
