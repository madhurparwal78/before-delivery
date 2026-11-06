import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarDay } from "../domain/dates.ts";
import { addDays, addMonths, dayString, daysInMonth, firstWeekday, longDate, monthTitle, parseDay } from "../domain/dates.ts";
import { journalNoteId } from "../domain/seed.ts";
import { openJournalNote } from "../store/actions.ts";
import { location, navigate, replaceAddress } from "../store/router.ts";
import { getRecord } from "../store/workspace.ts";
import { BlockList } from "./BlockList.tsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Calendar({ open }: { open: CalendarDay }) {
  const [focusDay, setFocusDay] = useState(open);
  const [moveFocus, setMoveFocus] = useState(false);
  const grid = useRef<HTMLTableElement>(null);
  const openString = dayString(open);
  useEffect(() => setFocusDay(open), [openString]);
  useEffect(() => {
    if (!moveFocus) return;
    grid.current?.querySelector<HTMLElement>(`[data-day="${dayString(focusDay)}"]`)?.focus();
    setMoveFocus(false);
  }, [moveFocus, focusDay]);
  const go = (day: CalendarDay): void => {
    setFocusDay(day);
    setMoveFocus(true);
  };
  const onKey = (event: KeyboardEvent<HTMLTableElement>): void => {
    const moves: Record<string, () => CalendarDay> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, -1),
      PageDown: () => addMonths(focusDay, 1),
    };
    const move = moves[event.key];
    if (move) go(move());
    else if (event.key === "Enter") navigate(`/journal/${dayString(focusDay)}`);
    else return;
    event.preventDefault();
  };
  const { year, month } = focusDay;
  const count = daysInMonth(year, month);
  const lead = firstWeekday(year, month);
  const cells: (CalendarDay | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, index) => ({ year, month, day: index + 1 })),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
  return (
    <section className="paper calendar">
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setFocusDay(addMonths(focusDay, -1))}><ChevronLeft aria-hidden="true" /></button>
        <h2>{monthTitle(focusDay)}</h2>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => setFocusDay(addMonths(focusDay, 1))}><ChevronRight aria-hidden="true" /></button>
      </div>
      <table ref={grid} role="grid" aria-label="Calendar" className="calendar-grid" onKeyDown={onKey}>
        <thead>
          <tr>{WEEKDAYS.map((name) => <th key={name} role="columnheader" scope="col">{name}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                if (!day) return <td key={dayIndex} role="gridcell" className="day-blank" />;
                const text = dayString(day);
                const hasNote = Boolean(getRecord("document", journalNoteId(text)));
                return (
                  <td
                    key={dayIndex}
                    role="gridcell"
                    data-day={text}
                    data-open={text === openString || undefined}
                    data-has-note={hasNote || undefined}
                    aria-label={`${longDate(day)}${hasNote ? ", has a note" : ""}`}
                    aria-selected={text === openString}
                    tabIndex={text === dayString(focusDay) ? 0 : -1}
                    onFocus={() => setFocusDay(day)}
                    onClick={() => navigate(`/journal/${text}`)}
                  >
                    <span aria-hidden="true">{day.day}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Journal({ date }: { date: string }) {
  const id = journalNoteId(date);
  useEffect(() => {
    openJournalNote(date);
    if (location.get().path === "/journal") replaceAddress(`/journal/${date}`);
  }, [date]);
  const day = parseDay(date);
  return (
    <div className="screen journal">
      <section role="region" aria-label="Journal note" className="paper journal-note">
        <h1 className="journal-date">{longDate(day)}</h1>
        <BlockList documentId={id} onSelect={() => undefined} />
      </section>
      <Calendar open={day} />
    </div>
  );
}
