import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { addDays, weekdayOf } from "../../shared/dates";
import type { CalendarState, DailyMonth, Game } from "../../shared/protocol";
import { ApiFailure, get, post } from "../api";
import { announce } from "../announcer";
import { clientConfig } from "../config";
import { longDate, monthTitle } from "../format";
import { useLoad } from "../hooks";
import { failureSentence, M56 } from "../messages";
import { navigate } from "../router";
import { Voice } from "./NotFound";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATE_WORDS: Record<CalendarState, string> = {
  solved: "solved",
  late: "solved late",
  missed: "missed",
  today: "today",
  future: "not open yet",
  closed: "not available",
};

function shiftMonth(month: string, by: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Monday-first weeks of the month; days of the neighbouring months are blank. */
function weeksOf(days: DailyMonth["days"]): (DailyMonth["days"][number] | null)[][] {
  const lead = weekdayOf(days[0]?.date ?? "1970-01-01");
  const cells = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export function Daily(): JSX.Element {
  const [month, setMonth] = useState<string | null>(null);
  const loaded = useLoad(() => get<DailyMonth>(month ? `/api/daily?month=${month}` : "/api/daily"), month ?? "today");
  const last = useRef<DailyMonth | null>(null);
  if (loaded.status === "ready") last.current = loaded.value;
  const data = loaded.status === "ready" ? loaded.value : last.current;
  const shown = month ?? data?.month ?? null;
  return (
    <section class="daily">
      <h1 class="page-title">Daily challenge</h1>
      {loaded.status === "failed" && <Voice sentence={failureSentence(loaded.error)} />}
      {!data && loaded.status === "loading" && <Voice sentence="The atelier is preparing your page." />}
      {data && shown && <Calendar data={data} shown={shown} pending={loaded.status === "loading"} onMonth={setMonth} />}
    </section>
  );
}

interface CalendarProps {
  data: DailyMonth;
  shown: string;
  pending: boolean;
  onMonth: (month: string) => void;
}

function Calendar({ data, shown, pending, onMonth }: CalendarProps): JSX.Element {
  const todayMonth = data.today.slice(0, 7);
  const firstMonth = clientConfig.dailyStart.slice(0, 7);
  const ready = !pending && data.month === shown;
  const [stop, setStop] = useState(data.today);
  const [opening, setOpening] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (!ready) return;
    const target = shown === todayMonth ? data.today : `${shown}-01`;
    setStop(target);
    if (first.current) {
      first.current = false;
      grid.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
    }
  }, [ready, shown]);

  const open = (date: string, state: CalendarState): void => {
    if (state === "future" || state === "closed" || opening) return;
    setOpening(true);
    post<{ game: Game }>(`/api/daily/${date}/game`).then(
      ({ game }) => navigate(`/play/${game.id}`),
      (error: unknown) => {
        setOpening(false);
        announce(error instanceof ApiFailure ? failureSentence(error) : M56);
      },
    );
  };

  const move = (date: string, by: number): void => {
    const next = addDays(date, by);
    if (!next.startsWith(shown)) return;
    setStop(next);
    grid.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  };

  const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const previousOff = shown <= firstMonth;
  const nextOff = shown >= todayMonth;
  return (
    <div class="daily-layout">
      <div class="tile calendar-tile">
        <div class="calendar-head">
          <button type="button" class="button icon-button" aria-label="Previous month" aria-disabled={previousOff ? "true" : "false"} onClick={() => !previousOff && onMonth(shiftMonth(shown, -1))}>
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
            </svg>
          </button>
          <h2 class="month-title">{monthTitle(shown)}</h2>
          <button type="button" class="button icon-button" aria-label="Next month" aria-disabled={nextOff ? "true" : "false"} onClick={() => !nextOff && onMonth(shiftMonth(shown, 1))}>
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
            </svg>
          </button>
        </div>
        {ready && (
          <div id="calendar" class="calendar" role="grid" aria-label={monthTitle(shown)} ref={grid}>
            <div class="calendar-row" role="row">
              {WEEKDAYS.map((name) => (
                <div class="calendar-weekday" role="columnheader" key={name}>
                  {name}
                </div>
              ))}
            </div>
            {weeksOf(data.days).map((week, index) => (
              <div class="calendar-row" role="row" key={index}>
                {week.map((day, column) =>
                  day ? (
                    <div
                      key={day.date}
                      class="day"
                      role="gridcell"
                      data-date={day.date}
                      data-state={day.state}
                      aria-label={`${longDate(day.date)}, ${STATE_WORDS[day.state]}`}
                      aria-disabled={day.state === "future" || day.state === "closed" ? "true" : undefined}
                      tabIndex={day.date === stop ? 0 : -1}
                      onFocus={() => setStop(day.date)}
                      onClick={() => open(day.date, day.state)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open(day.date, day.state);
                        } else if (keys[event.key] !== undefined) {
                          event.preventDefault();
                          move(day.date, keys[event.key] ?? 0);
                        }
                      }}
                    >
                      {Number(day.date.slice(8))}
                    </div>
                  ) : (
                    <div class="day blank" role="gridcell" key={`blank-${index}-${column}`} />
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="streaks">
        <p id="streak" class="streak-line">{`Current streak: ${data.current_streak} ${data.current_streak === 1 ? "day" : "days"}`}</p>
        <p id="best-streak" class="streak-line">{`Best streak: ${data.best_streak} ${data.best_streak === 1 ? "day" : "days"}`}</p>
      </div>
    </div>
  );
}
