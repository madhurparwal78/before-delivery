// Dates shown to people: `14 Mar 2026, 17:00`. The server's ISO strings already carry APP_TZ's wall-clock time and offset,
// so the digits are read as written and the browser's own zone never enters.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export function formatStamp(iso: string): string {
  const match = STAMP.exec(iso);
  if (!match) throw new Error(`Not a timestamp: ${iso}`);
  const [, year, month, day, hour, minute] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour}:${minute}`;
}
