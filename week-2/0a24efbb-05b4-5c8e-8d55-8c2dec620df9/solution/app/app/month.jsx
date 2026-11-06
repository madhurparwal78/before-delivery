import { Fragment } from "react";
import { addDays } from "../src/time.mjs";
import { Icon } from "./icons.jsx";
import { MARKS } from "./words.js";

// The month grid and its legend, drawn the same way on `/calendar` and on a shared month.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const WEEKDAYS = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"],
  ["Sat", "Saturday"], ["Sun", "Sunday"]];

/** `October 2026` for `2026-10`. */
export function monthName(month) {
  const [year, mon] = month.split("-").map(Number);
  return `${MONTHS[mon - 1]} ${year}`;
}

function weeks(days) {
  const first = days[0].day;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = lead; i > 0; i -= 1) cells.push({ outside: addDays(first, -i) });
  for (const day of days) cells.push(day);
  while (cells.length % 7) cells.push({ outside: addDays(days.at(-1).day, cells.length - lead - days.length + 1) });
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const SYLLABLE = /(?<=Attend|record|incom|appro|pend|Correc|wait)(?=ance|ed|plete|ved|ing|tion)/;

/** A mark's words with soft breaks at their syllables, for the narrow cells that cannot hold a whole word. */
function Syllables({ text }) {
  return text.split(SYLLABLE).map((part, i) => <Fragment key={part}>{i > 0 && <wbr />}{part}</Fragment>);
}

function Mark({ glyph, children }) {
  return (
    <li className="mark" data-mark={glyph}>
      <Icon name={glyph} size={16} />
      <span>{children}</span>
    </li>
  );
}

export function MonthGrid({ month, days }) {
  return (
    <div className="month-panel">
      <table className="month">
        <caption>{monthName(month)}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={short} scope="col"><abbr title={long}>{short}</abbr></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks(days).map((week) => (
            <tr key={week[0].day ?? week[0].outside}>
              {week.map((cell) => cell.outside ? (
                <td key={cell.outside} className="outside">
                  {`${Number(cell.outside.slice(8))} ${MONTHS[Number(cell.outside.slice(5, 7)) - 1].slice(0, 3)}`}
                </td>
              ) : (
                <td key={cell.day}>
                  <span className="dnum">{Number(cell.day.slice(8))}</span>
                  <ul className="marks">
                    {MARKS.filter(([field]) => cell.counts[field] > 0).map(([field, label, glyph]) => (
                      <Mark key={field} glyph={glyph}>
                        <Syllables text={label.slice(0, label.lastIndexOf(" ") + 1)} />
                        <span className="mark-tail"><Syllables text={`${label.slice(label.lastIndexOf(" ") + 1)}: ${cell.counts[field]}`} /></span>
                      </Mark>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend() {
  return (
    <section className="legend" aria-labelledby="legend-title">
      <h2 id="legend-title">What the marks mean</h2>
      <ul className="marks legend-marks">
        {MARKS.map(([field, label, glyph]) => <Mark key={field} glyph={glyph}>{label}</Mark>)}
      </ul>
    </section>
  );
}
