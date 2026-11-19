import { dayOfMonth, monthYearLabel, weekdayLetter } from "../../shared/calendar";
import { DAY_PX, type ChartDay } from "../chart";

export function MonthLabels({ days, height }: { days: readonly ChartDay[]; height: number }) {
  return (
    <div className="month-row" style={{ height }} aria-hidden="true">
      {days.map((day, column) =>
        column === 0 || dayOfMonth(day.date) === 1 ? (
          <span key={day.date} className="month-label" style={{ left: column * DAY_PX }}>
            {monthYearLabel(day.date)}
          </span>
        ) : null,
      )}
    </div>
  );
}

export function DayHeader({ days, top, height }: { days: readonly ChartDay[]; top: number; height: number }) {
  return (
    <div className="day-row" style={{ top, height }}>
      {days.map((day, column) => (
        <div
          key={day.date}
          className="day-cell"
          data-day={day.date}
          data-working={String(day.working)}
          data-holiday={day.holiday ?? undefined}
          style={{ left: column * DAY_PX }}
        >
          <span className="day-letter">{weekdayLetter(day.date)}</span>
          <span className="day-number">{dayOfMonth(day.date)}</span>
        </div>
      ))}
    </div>
  );
}
