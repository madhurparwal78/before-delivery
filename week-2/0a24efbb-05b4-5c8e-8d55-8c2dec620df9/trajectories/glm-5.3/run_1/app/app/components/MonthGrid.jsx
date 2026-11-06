import { MARK_GLYPH, MARK_LABEL } from './icons.jsx';
import { MONTH_NAMES, WEEKDAYS, addMonths, monthName, daysInMonth } from '../../src/domain/time.js';

export const MARKS = Object.entries(MARK_LABEL);

export function MonthGrid({ month, days }) {
  const firstWeekday = (new Date(Date.UTC(
    Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1
  )).getUTCDay() + 6) % 7;
  const leading = [];
  if (firstWeekday > 0) {
    const prevMonth = addMonths(month, -1);
    const prevDays = daysInMonth(prevMonth);
    for (let i = firstWeekday - 1; i >= 0; i--) {
      leading.push({ day: `${prevMonth}-${String(prevDays - i).padStart(2, '0')}`, out: true });
    }
  }
  const trailing = [];
  const total = leading.length + days.length;
  const rows = Math.ceil(total / 7);
  const trailingCount = rows * 7 - total;
  if (trailingCount > 0) {
    const nextMonth = addMonths(month, 1);
    for (let i = 1; i <= trailingCount; i++) {
      trailing.push({ day: `${nextMonth}-${String(i).padStart(2, '0')}`, out: true });
    }
  }
  const cells = [...leading, ...days.map((d) => ({ ...d, out: false })), ...trailing];

  return (
    <table className="month-grid">
      <caption>{monthName(month)} {month.slice(0, 4)}</caption>
      <thead>
        <tr>{WEEKDAYS.map((w) => <th key={w} scope="col" abbr={w}>{w}</th>)}</tr>
      </thead>
      <tbody>
        {chunk(cells, 7).map((week, i) => (
          <tr key={i}>
            {week.map((cell) => {
              if (cell.out) {
                const d = Number(cell.day.slice(8, 10));
                const mon = MONTH_NAMES[Number(cell.day.slice(5, 7)) - 1].slice(0, 3);
                return <td key={cell.day} className="out-of-month"><span>{d} {mon}</span></td>;
              }
              const counts = cell.counts || {};
              return (
                <td key={cell.day} className="in-month">
                  <span className="day-number">{Number(cell.day.slice(8, 10))}</span>
                  {MARKS.map(([key, label]) => {
                    const n = counts[key] || 0;
                    if (n === 0) return null;
                    const Glyph = MARK_GLYPH[key];
                    return (
                      <span key={key} className="cell-mark">
                        <Glyph className="mark-glyph" />
                        <span className="mark-word">{label}: {n}</span>
                      </span>
                    );
                  })}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MarkLegend() {
  return (
    <div className="legend">
      <h2>What the marks mean</h2>
      <ul>
        {MARKS.map(([key, label]) => {
          const Glyph = MARK_GLYPH[key];
          return (
            <li key={key}>
              <Glyph className="mark-glyph" />
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
