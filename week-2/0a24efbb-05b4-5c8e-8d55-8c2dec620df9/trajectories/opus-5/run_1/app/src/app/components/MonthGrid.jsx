import { addDays, dayOfMonth, monthTitle, shortMonthName, weekdayIndex } from '../../shared/businessTime.js';
import { CALENDAR_MARKS } from '../../shared/constants.js';
import { ui } from '../../shared/copy.js';
import { Icon } from './Icon.jsx';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weeksOf(days) {
  const first = days[0].day;
  const last = days[days.length - 1].day;
  const cells = [];
  for (let back = weekdayIndex(first); back > 0; back -= 1) {
    cells.push({ day: addDays(first, -back), outside: true });
  }
  for (const entry of days) cells.push({ ...entry, outside: false });
  for (let ahead = 1; (weekdayIndex(last) + ahead) % 7 !== 0; ahead += 1) {
    cells.push({ day: addDays(last, ahead), outside: true });
  }
  const weeks = [];
  for (let start = 0; start < cells.length; start += 7) weeks.push(cells.slice(start, start + 7));
  return weeks;
}

export function MonthGrid({ month, days }) {
  const weeks = weeksOf(days);
  return (
    <table className="month-grid">
      <caption>{monthTitle(month)}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((name) => (
            <th key={name} scope="col">
              <abbr title={name}>{name.slice(0, 3)}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].day}>
            {week.map((cell) =>
              cell.outside ? (
                <td key={cell.day} className="cell outside">
                  <span className="cell-day third">{`${dayOfMonth(cell.day)} ${shortMonthName(cell.day)}`}</span>
                </td>
              ) : (
                <td key={cell.day} className="cell">
                  <span className="cell-day figures">{dayOfMonth(cell.day)}</span>
                  <ul className="marks">
                    {CALENDAR_MARKS.filter((mark) => cell.counts[mark.key] > 0).map((mark) => (
                      <li key={mark.key} className={`mark mark-${mark.key}`}>
                        <Icon name={mark.glyph} size={14} />
                        <span className="figures">{`${mark.label}: ${cell.counts[mark.key]}`}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MonthLegend() {
  return (
    <section className="legend">
      <h2>{ui.legendHeading}</h2>
      <ul>
        {CALENDAR_MARKS.map((mark) => (
          <li key={mark.key} className={`mark mark-${mark.key}`}>
            <Icon name={mark.glyph} size={16} />
            <span>{mark.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
