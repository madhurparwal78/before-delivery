export const TIME_ZONE = "America/Los_Angeles";

const pacificParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Tidecraft's time zone, as YYYY-MM-DD. */
export function serverDate(at: Date): string {
  return pacificParts.format(at);
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function parseYmd(text: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatYmd(date: CivilDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The vesting mark date: the start plus m calendar months, clamped to the month's last day. */
export function addMonthsClamped(start: CivilDate, months: number): CivilDate {
  const zeroBased = start.month - 1 + months;
  const year = start.year + Math.floor(zeroBased / 12);
  const month = (zeroBased % 12 + 12) % 12 + 1;
  const day = Math.min(start.day, daysInMonth(year, month));
  return { year, month, day };
}

export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
