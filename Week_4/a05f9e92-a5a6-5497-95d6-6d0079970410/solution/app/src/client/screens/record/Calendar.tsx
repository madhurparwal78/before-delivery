import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { get } from "../../lib/api.js";
import { Modal } from "../../lib/dialog.js";
import { useTopics } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { Button, Rest, StatusBlock } from "../../lib/ui.js";
import { MONTH_NAMES, WEEKDAY_NAMES } from "./names.js";

interface Day {
  date: string;
  changes: Array<{ number: string; title: string; planned_start: string; planned_end: string }>;
  freezes: string[];
}

interface Ymd {
  year: number;
  month: number;
  day: number;
}

const two = (n: number): string => String(n).padStart(2, "0");
const monthKey = ({ year, month }: Ymd): string => `${year}-${two(month)}`;
const dateKey = (d: Ymd): string => `${monthKey(d)}-${two(d.day)}`;
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekdayOf = (d: Ymd): number => (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;

function addDays(d: Ymd, delta: number): Ymd {
  const moved = new Date(Date.UTC(d.year, d.month - 1, d.day + delta));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** The same day in another month, or that month's last day when the day does not exist in it. */
function addMonths(d: Ymd, delta: number): Ymd {
  const index = d.year * 12 + (d.month - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(d.day, daysIn(year, month)) };
}

function cellName(d: Ymd, count: number): string {
  return `${WEEKDAY_NAMES[weekdayOf(d)]}, ${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}, ${count} ${count === 1 ? "change" : "changes"}`;
}

/** Month data by month key; a month nobody has loaded yet counts no changes until it arrives. */
function useMonths(shown: Ymd): { days: Map<string, Day>; loading: boolean } {
  const [months, setMonths] = useState<Record<string, Day[]>>({});
  const key = monthKey(shown);
  const load = useCallback((target: string): void => {
    get<{ days: Day[] }>(`/api/changes/calendar?month=${target}`).then(
      (response) => setMonths((previous) => ({ ...previous, [target]: response.days })),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    load(key);
    load(monthKey(addMonths(shown, -1)));
    load(monthKey(addMonths(shown, 1)));
  }, [key, load]);
  useTopics(["list:change"], () => load(key));
  const days = new Map<string, Day>();
  for (const list of Object.values(months)) for (const day of list) days.set(day.date, day);
  return { days, loading: months[key] === undefined };
}

/** The change calendar: a month grid, seven columns on every viewport, moved by the arrow, Page and Home/End keys. */
export function ChangeCalendar(): JSX.Element {
  const [focus, setFocus] = useState<Ymd>(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() + 1, day: 1 };
  });
  const [open, setOpen] = useState<Ymd | null>(null);
  const moved = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const { days, loading } = useMonths(focus);

  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${dateKey(focus)}"]`)?.focus();
  }, [focus]);

  const go = (next: Ymd, withFocus: boolean): void => {
    moved.current = withFocus;
    setFocus(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step: Record<string, () => Ymd> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -weekdayOf(focus)),
      End: () => addDays(focus, 6 - weekdayOf(focus)),
    };
    const target = step[event.key];
    if (target) {
      event.preventDefault();
      go(target(), true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(focus);
    }
  };

  const length = daysIn(focus.year, focus.month);
  const lead = weekdayOf({ ...focus, day: 1 });
  const slots: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => i + 1)];
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks = Array.from({ length: slots.length / 7 }, (_, i) => slots.slice(i * 7, i * 7 + 7));
  const openDay = open ? days.get(dateKey(open)) : undefined;

  return (
    <main className="page page-wide">
      <h1 className="subject cal-subject">
        {MONTH_NAMES[focus.month - 1]} {focus.year}
      </h1>
      <Rest>
        <div className="cal-bar">
          <Button variant="outline" onClick={() => go(addMonths(focus, -1), false)}>
            Previous month
          </Button>
          <Button variant="outline" onClick={() => go(addMonths(focus, 1), false)}>
            Next month
          </Button>
        </div>
        <div ref={grid} role="grid" aria-label="Change calendar" aria-busy={loading || undefined} className="cal-grid" onKeyDown={onKeyDown}>
          <div role="row" className="cal-row cal-head">
            {WEEKDAY_NAMES.map((name) => (
              <div key={name} role="columnheader" className="cal-weekday" aria-label={name}>
                <span aria-hidden="true">{name.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          {weeks.map((week, row) => (
            <div key={row} role="row" className="cal-row">
              {week.map((day, column) => {
                if (day === null) return <div key={column} role="gridcell" aria-hidden="true" className="cal-cell cal-blank" />;
                const here: Ymd = { year: focus.year, month: focus.month, day };
                const entry = days.get(dateKey(here));
                const count = entry ? entry.changes.length : 0;
                const frozen = !!entry && entry.freezes.length > 0;
                return (
                  <div
                    key={column}
                    role="gridcell"
                    data-date={dateKey(here)}
                    aria-label={cellName(here, count)}
                    aria-describedby={frozen ? `${dateKey(here)}-freeze` : undefined}
                    tabIndex={day === focus.day ? 0 : -1}
                    className={`cal-cell ${frozen ? "cal-freeze" : ""}`}
                    onClick={() => {
                      go(here, true);
                      setOpen(here);
                    }}
                  >
                    <span className="cal-date" aria-hidden="true">
                      {day}
                    </span>
                    {/* The count and the Freeze word are drawn from CSS so the cell's visible text stays the day number, which the pinned name contains. */}
                    <span className={count > 0 ? "cal-count cal-count-some" : "cal-count"} data-count={count} aria-hidden="true" />
                    {frozen ? (
                      <span className="cal-frozen" data-label="Freeze" aria-hidden="true">
                        <span id={`${dateKey(here)}-freeze`} className="sr-only">
                          Freeze
                        </span>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Rest>
      {open ? (
        <Modal label={`Changes on ${open.day} ${MONTH_NAMES[open.month - 1]} ${open.year}`} onClose={() => setOpen(null)} className="cal-dialog">
          <h3>
            {open.day} {MONTH_NAMES[open.month - 1]} {open.year}
          </h3>
          {openDay && openDay.freezes.length > 0 ? (
            <p>
              <StatusBlock>Freeze</StatusBlock> {openDay.freezes.join(", ")}
            </p>
          ) : null}
          {openDay && openDay.changes.length > 0 ? (
            <ul className="cal-list">
              {openDay.changes.map((change) => (
                <li key={change.number}>
                  <Link to={`/desk/records/${change.number}`}>
                    {change.number}: {change.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No changes on this day.</p>
          )}
          <div className="row">
            <Button variant="outline" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
