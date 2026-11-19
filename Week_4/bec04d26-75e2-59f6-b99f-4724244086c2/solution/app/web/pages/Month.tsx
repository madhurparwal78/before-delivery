import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, type KeyboardEvent, useCallback, useLayoutEffect, useState } from "react";
import { addDays, addMonths, dateWords, daysInMonth, monthTitle, weekday } from "../../shared/calendar";
import type { ReturnView } from "../../shared/types";
import { announce, PRIORITY } from "../announce";
import { Band } from "../components/Band";
import { EmptyTile, returnData } from "../components/Tile";
import { useReturnList } from "../hooks";
import { useMediaQuery } from "../lib/dom";
import { navigate } from "../router";
import { useApp } from "../store";

const WEEKDAY_HEADS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Set just before a keyboard move changes month, so the new grid puts focus on the day the move landed on. */
let pendingFocus: string | null = null;

const monday = (date: string): string => addDays(date, -((weekday(date) + 6) % 7));
const pad = (n: number): string => String(n).padStart(2, "0");

/** The same day number in another month, clamped to that month's last day. */
function inMonth(month: string, day: number, change: number): string {
  const target = addMonths(month, change);
  return `${target}-${pad(Math.min(day, daysInMonth(Number(target.slice(0, 4)), Number(target.slice(5)))))}`;
}

function Chip({ r }: { r: ReturnView }) {
  return (
    <span className={`chip tone-${r.overdue ? "black" : r.tone}`} {...returnData(r)}>
      <span>{`${r.state} · ${r.status_label}${r.overdue ? " · Overdue" : ""}`}</span>
      {r.carried_from && <small>{`Carried from ${dateWords(r.carried_from)}`}</small>}
      {r.status === "amended" && <small>{`Gross sales ${r.gross_sales} · Tax due ${r.tax_due}`}</small>}
    </span>
  );
}

interface DayProps {
  date: string;
  returns: ReturnView[];
  ghosts: ReturnView[];
  tabStop: boolean;
  onToggle: (date: string) => void;
  onFocus: (date: string) => void;
}

function Day({ date, returns, ghosts, tabStop, onToggle, onFocus }: DayProps) {
  const filled = returns.length + ghosts.length > 0;
  // The cell is named from its content, the brief's "<Weekday> <Month> <day>" alone; its chips and ghosts are its
  // description, so the name holds every word the reader sees as the name.
  return (
    <div role="gridcell" aria-describedby={filled ? `day-items-${date}` : undefined}
      data-date={date} data-count={returns.length} className="day"
      tabIndex={tabStop ? 0 : -1} onFocus={() => onFocus(date)}
      onClick={() => onToggle(date)}>
      <span className="sr-only">{dateWords(date)}</span>
      <span className="day-number" aria-hidden="true">{Number(date.slice(8))}</span>
      <span className="day-words" aria-hidden="true">{dateWords(date)}</span>
      {filled && (
        <div id={`day-items-${date}`} className="day-items" aria-hidden="true">
          {returns.map((r) => <Chip key={r.id} r={r} />)}
          {ghosts.map((r) => (
            <p key={r.id} className="ghost" data-ghost-for={r.id} title={`Carried to ${dateWords(r.due_date)}`}>{`${r.state} · Carried from here`}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export function Month({ month }: { month: string }) {
  const clock = useApp((s) => s.clock)!;
  const phone = useMediaQuery("(max-width: 640px)");
  const list = useReturnList(`/api/returns?month=${month}`);
  const following = useReturnList(`/api/returns?month=${addMonths(month, 1)}`);
  const [year, mm] = [Number(month.slice(0, 4)), Number(month.slice(5))];
  const first = `${month}-01`;
  const last = `${month}-${pad(daysInMonth(year, mm))}`;
  const [tabStop, setTabStop] = useState(() => {
    if (pendingFocus?.startsWith(month)) return pendingFocus;
    return clock.today.startsWith(month) ? clock.today : first;
  });
  const [band, setBand] = useState<{ date: string; seq: number; closing: boolean } | null>(null);
  // The grid paints once both lists are in, so arriving chips and ghosts never grow the day rows under the reader.
  const ready = Boolean(list && following);

  useLayoutEffect(() => {
    if (ready && pendingFocus?.startsWith(month)) {
      document.querySelector<HTMLElement>(`[data-date="${pendingFocus}"]`)?.focus();
      pendingFocus = null;
    }
  }, [month, ready]);

  const leading = (weekday(first) + 6) % 7;
  const days = Array.from({ length: daysInMonth(year, mm) }, (_, i) => `${month}-${pad(i + 1)}`);
  const cells: (string | null)[] = [...Array(leading).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const dueOn = (date: string): ReturnView[] => (list?.returns ?? []).filter((r) => r.due_date === date);
  const ghostsOn = (date: string): ReturnView[] =>
    [...(list?.returns ?? []), ...(following?.returns ?? [])].filter((r) => r.carried_from === date);

  const toggle = useCallback((date: string) => {
    const returns = (list?.returns ?? []).filter((r) => r.due_date === date);
    if (!returns.length) return;
    if (band && band.date === date && !band.closing) {
      setBand({ ...band, closing: true });
      return;
    }
    setBand((previous) => ({ date, seq: (previous?.seq ?? 0) + 1, closing: false }));
    announce(`${returns.length === 1 ? "1 return" : `${returns.length} returns`} due ${dateWords(date)}.`, PRIORITY.bandOpened);
  }, [band, list]);

  const collapsed = useCallback((seq: number) => setBand((current) => (current && current.seq === seq ? null : current)), []);

  const goTo = (date: string): void => {
    if (date.startsWith(month)) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
    else {
      pendingFocus = date;
      navigate(`/month/${date.slice(0, 7)}`);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-date]");
    if (!cell) return;
    const date = cell.dataset.date!;
    const day = Number(date.slice(8));
    const week = (weekday(date) + 6) % 7;
    const target: string | null = ({
      ArrowLeft: addDays(date, -1), ArrowRight: addDays(date, 1), ArrowUp: addDays(date, -7), ArrowDown: addDays(date, 7),
      Home: monday(date) < first ? first : monday(date),
      End: addDays(date, 6 - week) > last ? last : addDays(date, 6 - week),
      PageUp: inMonth(month, day, -1),
      PageDown: inMonth(month, day, 1),
    } as Record<string, string>)[event.key] ?? null;
    if (target) {
      event.preventDefault();
      goTo(target);
    } else if (event.key === "Enter") {
      event.preventDefault();
      toggle(date);
    } else if (event.key === "Escape" && band && !band.closing) {
      event.preventDefault();
      setBand({ ...band, closing: true });
    }
  };

  const counts = list?.counts;
  const openBand = band && (
    <Band key={band.seq} date={band.date} returns={dueOn(band.date)} clock={clock} closing={band.closing}
      onCollapsed={() => collapsed(band.seq)} />
  );

  return (
    <main className="month">
      <h1>Due dates</h1>
      <div className="month-head">
        <h2>{monthTitle(month)}</h2>
        <div className="pager">
          <button type="button" className="button" onClick={() => navigate(`/month/${addMonths(month, -1)}`)}>
            <ChevronLeft aria-hidden="true" size={20} />Previous month
          </button>
          <button type="button" className="button" onClick={() => navigate(`/month/${addMonths(month, 1)}`)}>
            Next month<ChevronRight aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="counts">
          <p role="status" aria-label="Overdue count">{`${counts?.overdue ?? 0} overdue`}</p>
          <p role="status" aria-label="Awaiting approval count">{`${counts?.awaiting_approval ?? 0} awaiting approval`}</p>
        </div>
      </div>
      {ready && <div role="grid" aria-label="Due dates" className="calendar" onKeyDown={onKey}>
        <div role="row" className="weekdays">
          {WEEKDAY_HEADS.map((name) => <div key={name} role="columnheader">{name}</div>)}
        </div>
        {weeks.map((week) => {
          const open = band && week.includes(band.date) ? band.date : null;
          return (
            <Fragment key={week.find(Boolean) ?? "blank"}>
              <div role="row" className="week">
                {week.map((date, i) => (date === null
                  ? <div key={`blank-${i}`} role="gridcell" aria-hidden="true" className="blank" />
                  : (
                    <Fragment key={date}>
                      <Day date={date} returns={dueOn(date)} ghosts={ghostsOn(date)} tabStop={date === tabStop}
                        onToggle={toggle} onFocus={setTabStop} />
                      {phone && open === date && <div role="gridcell" className="band-cell">{openBand}</div>}
                    </Fragment>
                  )))}
              </div>
              {!phone && open && <div role="row" className="band-row"><div role="gridcell" className="band-cell">{openBand}</div></div>}
            </Fragment>
          );
        })}
      </div>}
      {counts?.total === 0 && <EmptyTile>No returns due this month.</EmptyTile>}
    </main>
  );
}
