// Agency time is America/New_York. All display uses the 24-hour clock.
export const AGENCY_TZ = 'America/New_York';

function parts(d: Date): { date: string; time: string; weekday: string; day: string; month: string; year: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: AGENCY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value ?? '';
  const pick = (k: string): string => out[k] ?? '';
  const date = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const time = pick('hour') === '24' ? '00:00' : `${pick('hour')}:${pick('minute')}`;
  return { date, time, weekday: pick('weekday'), day: pick('day'), month: pick('month'), year: pick('year') };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function agencyDateKey(d: Date): string {
  return parts(d).date;
}

export function agencyTime(d: Date): string {
  return parts(d).time;
}

// "Tue 27 Oct" on cards.
export function cardDate(d: Date): string {
  const p = parts(d);
  return `${p.weekday} ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
}

// "Tuesday 27 October" in day headings.
export function headingDate(d: Date): string {
  const p = parts(d);
  const weekday = WEEKDAYS_FULL[new Date(`${p.date}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${Number(p.day)} ${MONTHS_FULL[Number(p.month) - 1]}`;
}

// Typed textbox format: YYYY-MM-DDTHH:MM in agency time.
export function agencyStamp(d: Date): string {
  const p = parts(d);
  return `${p.date}T${p.time}`;
}

// Converts a typed YYYY-MM-DDTHH:MM value into an ISO instant with offset.
// America/New_York is UTC-5 or UTC-4; both mappings are tried and verified.
export function typedToInstant(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const probe = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`).getTime();
  if (Number.isNaN(probe)) return null;
  for (const offsetMin of [300, 240]) {
    const inst = new Date(probe + offsetMin * 60_000);
    if (agencyDateKey(inst) === `${y}-${mo}-${d}` && agencyTime(inst) === `${h}:${mi}`) {
      const sign = offsetMin === 300 ? '-' : '-';
      const hh = String(Math.floor(offsetMin / 60)).padStart(2, '0');
      const mm = String(offsetMin % 60).padStart(2, '0');
      return `${y}-${mo}-${d}T${h}:${mi}:00${sign}${hh}:${mm}`;
    }
  }
  return null;
}

export function isValidTypedDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function formatMoney(amount: string): string {
  return `$${amount}`;
}
