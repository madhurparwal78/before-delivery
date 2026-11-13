import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  addDays, addMonths, buttonDate, calendarKey, daysBetween, daysInMonth, longDate, monthTitle, weekdayOf,
  type CalendarDay,
} from "../../shared/time";
import { announce } from "../lib/announce";
import { Dialog } from "./Dialog";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

interface Props {
  value: CalendarDay;
  today: CalendarDay;
  onChange: (day: CalendarDay) => void;
}

function monthGrid(year: number, month: number): CalendarDay[][] {
  const first: CalendarDay = { year, month, day: 1 };
  const start = addDays(first, -weekdayOf(first));
  const last: CalendarDay = { year, month, day: daysInMonth(year, month) };
  const end = addDays(last, 6 - weekdayOf(last));
  const weeks: CalendarDay[][] = [];
  for (let at = start; daysBetween(at, end) >= 0; at = addDays(at, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(at, i)));
  }
  return weeks;
}

export function DateField({ value, today, onChange }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<CalendarDay>(value);
  const grid = useRef<HTMLDivElement | null>(null);
  const shownMonth = useRef(`${value.year}-${value.month}`);
  const wantFocus = useRef(false);

  useEffect(() => {
    if (!open) return;
    const key = `${focus.year}-${focus.month}`;
    if (key !== shownMonth.current) {
      shownMonth.current = key;
      announce(monthTitle(focus.year, focus.month));
    }
  }, [focus, open]);

  useEffect(() => {
    if (!open) return;
    const cell = grid.current?.querySelector<HTMLElement>(`[data-day="${calendarKey(focus)}"]`);
    if (cell && wantFocus.current) {
      wantFocus.current = false;
      cell.focus();
    }
  }, [focus, open]);

  const openPicker = (): void => {
    setFocus(value);
    shownMonth.current = `${value.year}-${value.month}`;
    setOpen(true);
  };

  const pick = (day: CalendarDay): void => {
    if (daysBetween(today, day) < 0) {
      announce("Past dates cannot be chosen");
      return;
    }
    setOpen(false);
    onChange(day);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, (d: CalendarDay) => CalendarDay> = {
      ArrowLeft: (d) => addDays(d, -1),
      ArrowRight: (d) => addDays(d, 1),
      ArrowUp: (d) => addDays(d, -7),
      ArrowDown: (d) => addDays(d, 7),
      PageUp: (d) => addMonths(d, -1),
      PageDown: (d) => addMonths(d, 1),
      Home: (d) => addDays(d, -weekdayOf(d)),
      End: (d) => addDays(d, 6 - weekdayOf(d)),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      wantFocus.current = true;
      setFocus(move);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(focus);
    }
  };

  const title = monthTitle(focus.year, focus.month);
  const label = buttonDate(value);

  return (
    <div className="date-field">
      <span className="field-label" id="date-label">
        Date
      </span>
      <button type="button" className="field-button" aria-label={`Date, ${label}`} aria-haspopup="dialog" onClick={openPicker}>
        {label}
      </button>
      <Dialog
        open={open}
        title="Choose a date"
        sheet
        className="dialog-calendar"
        onClose={() => setOpen(false)}
        initialFocus={(root) => root.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')}
      >
        <div className="cal-head">
          <button type="button" onClick={() => setFocus((d) => addMonths(d, -1))}>
            Previous month
          </button>
          <button type="button" onClick={() => setFocus((d) => addMonths(d, 1))}>
            Next month
          </button>
        </div>
        <div role="grid" aria-label={title} ref={grid} onKeyDown={onKeyDown} className="cal-grid">
          <div role="row" className="cal-row">
            {WEEKDAYS.map((name) => (
              <span key={name} role="columnheader" className="cal-weekday">
                {name}
              </span>
            ))}
          </div>
          {monthGrid(focus.year, focus.month).map((week) => (
            <div role="row" className="cal-row" key={calendarKey(week[0]!)}>
              {week.map((day) => {
                const key = calendarKey(day);
                const past = daysBetween(today, day) < 0;
                const outside = day.month !== focus.month;
                const selected = key === calendarKey(value);
                return (
                  <div
                    key={key}
                    role="gridcell"
                    data-day={key}
                    aria-label={longDate(day)}
                    aria-selected={selected}
                    aria-disabled={past || undefined}
                    tabIndex={key === calendarKey(focus) ? 0 : -1}
                    className={`cal-cell${past ? " is-past" : ""}${outside ? " is-outside" : ""}${selected ? " is-selected" : ""}`}
                    onClick={() => pick(day)}
                  >
                    {day.day}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
