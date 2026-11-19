/** Date recognition and display, decided once for the server's saves and the browser's chips. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DATE_TOKEN = /!\(([^()]*)\)/g;

export interface RecognisedDate {
  /** The text with the first recognised token rewritten to `!(YYYY-MM-DD)`. */
  text: string;
  /** The stored date, or null when no token was recognised. */
  date: string | null;
}

function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const made = new Date(stamp);
  if (made.getUTCFullYear() !== year || made.getUTCMonth() !== month - 1 || made.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate()) ?? iso;
}

/** Reads one `!(…)` body against `today` (`YYYY-MM-DD`), or null when it is not a date. */
function readDateToken(body: string, today: string): string | null {
  const value = body.trim();
  const lower = value.toLowerCase();
  if (lower === 'today') return today;
  if (lower === 'tomorrow') return addDays(today, 1);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayMonthYear = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value);
  if (dayMonthYear) {
    const month = MONTHS.indexOf(dayMonthYear[2]!.toLowerCase()) + 1;
    if (month === 0) return null;
    return isoOf(Number(dayMonthYear[3]), month, Number(dayMonthYear[1]));
  }

  const monthDay = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(value);
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1]!.toLowerCase()) + 1;
    if (month === 0) return null;
    const day = Number(monthDay[2]);
    const thisYear = Number(today.slice(0, 4));
    const candidate = isoOf(thisYear, month, day);
    if (candidate === null) return null;
    if (candidate >= today) return candidate;
    return isoOf(thisYear + 1, month, day);
  }

  return null;
}

/** Rewrites the first recognised date token and reports the date it holds. */
export function recogniseDate(text: string, today: string): RecognisedDate {
  DATE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATE_TOKEN.exec(text)) !== null) {
    const date = readDateToken(match[1] ?? '', today);
    if (date !== null) {
      const start = match.index;
      const end = start + match[0].length;
      return { text: `${text.slice(0, start)}!(${date})${text.slice(end)}`, date };
    }
  }
  return { text, date: null };
}

/** The one display format: day without a leading zero, three-letter month, four-digit year. */
export function formatDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;
  const month = MONTH_NAMES[Number(parts[2]) - 1] ?? parts[2]!;
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}
