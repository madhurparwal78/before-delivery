// UK business time, worked out by arithmetic so every page and server read prints the same text
// whatever the device's locale, zone or clock. Instants are whole UTC seconds.
export type LocalDate = string; // YYYY-MM-DD
type LocalTime = string; // HH:MM
type RepeatedHour = "first" | "second";
export interface LocalDateTime { date: LocalDate; time: LocalTime; repeatedHour?: RepeatedHour }

const DAY = 86400;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");

const parts = (date: LocalDate): [number, number, number] => {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
};
const utcSeconds = (date: LocalDate): number => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / 1000;
};
const fromUtcSeconds = (seconds: number): LocalDate => {
  const at = new Date(seconds * 1000);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};

export const isRealDate = (date: unknown): date is string => {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = parts(date);
  if (y < 1) return false;
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
};
export const isTime = (time: unknown): time is LocalTime => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export const addDays = (date: LocalDate, days: number): LocalDate => fromUtcSeconds(utcSeconds(date) + days * DAY);
export const daysBetween = (from: LocalDate, to: LocalDate): number => Math.round((utcSeconds(to) - utcSeconds(from)) / DAY);
export const weekdayIndex = (date: LocalDate): number => new Date(utcSeconds(date) * 1000).getUTCDay();

/** Typed DD/MM/YYYY to an ISO date, or null for anything else or a date that does not exist. */
export const typedToDate = (typed: string): LocalDate | null => {
  const found = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(typed.trim());
  if (!found) return null;
  const date = `${found[3]}-${found[2]}-${found[1]}`;
  return isRealDate(date) ? date : null;
};
export const dateToTyped = (date: LocalDate): string => {
  const [y, m, d] = parts(date);
  return `${pad(d)}/${pad(m)}/${y}`;
};

const lastSunday = (year: number, month: number): LocalDate => {
  const end = new Date(Date.UTC(year, month, 0));
  const day = end.getUTCDate() - end.getUTCDay();
  return `${year}-${pad(month)}-${pad(day)}`;
};
const springChange = (year: number): LocalDate => lastSunday(year, 3);
const autumnChange = (year: number): LocalDate => lastSunday(year, 10);

const inBst = (instant: number): boolean => {
  const year = new Date(instant * 1000).getUTCFullYear();
  return instant >= utcSeconds(springChange(year)) + 3600 && instant < utcSeconds(autumnChange(year)) + 3600;
};

const ukParts = (instant: number): { date: LocalDate; time: LocalTime; bst: boolean; second: number } => {
  const bst = inBst(instant);
  const local = new Date((instant + (bst ? 3600 : 0)) * 1000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    bst,
    second: local.getUTCSeconds(),
  };
};
export const ukDate = (instant: number): LocalDate => ukParts(instant).date;
export const ukTime = (instant: number): LocalTime => ukParts(instant).time;

const inChangeHour = (date: LocalDate, time: LocalTime, change: (y: number) => LocalDate): boolean =>
  date === change(parts(date)[0]) && time >= "01:00" && time < "02:00";
export const isMissingHour = (date: LocalDate, time: LocalTime): boolean => inChangeHour(date, time, springChange);
export const isRepeatedHour = (date: LocalDate, time: LocalTime): boolean => inChangeHour(date, time, autumnChange);

/** The instant of a UK wall time. A repeated hour reads as its first pass unless `second` is asked. */
export const toInstant = (at: LocalDateTime): number => {
  const [h, m] = at.time.split(":").map(Number);
  const asUtc = utcSeconds(at.date) + h * 3600 + m * 60;
  if (isRepeatedHour(at.date, at.time)) return at.repeatedHour === "second" ? asUtc : asUtc - 3600;
  return inBst(asUtc - 3600) ? asUtc - 3600 : asUtc;
};
export const instantToLocal = (instant: number): LocalDateTime => {
  const { date, time } = ukParts(instant);
  if (!isRepeatedHour(date, time)) return { date, time };
  return { date, time, repeatedHour: inBst(instant) ? "first" : "second" };
};
/** The last whole second of a UK calendar day. */
export const endOfUkDay = (date: LocalDate): number => toInstant({ date: addDays(date, 1), time: "00:00" }) - 1;

export const hoursInDay = (date: LocalDate): number => {
  const [year] = parts(date);
  return date === springChange(year) ? 23 : date === autumnChange(year) ? 25 : 24;
};
export const clockChangeLabel = (date: LocalDate): string | null => {
  const hours = hoursInDay(date);
  return hours === 23 ? "Clocks go forward 01:00" : hours === 25 ? "Clocks go back 02:00" : null;
};
/** The UK date of the next clock change strictly after `date`. */
export const nextClockChange = (date: LocalDate): LocalDate => {
  const [year] = parts(date);
  return [springChange(year), autumnChange(year), springChange(year + 1)].find((change) => change > date) as LocalDate;
};

export const longDate = (date: LocalDate): string => {
  const [y, m, d] = parts(date);
  return `${WEEKDAYS[weekdayIndex(date)]} ${d} ${MONTHS[m - 1]} ${y}`;
};
export const longDateTime = (date: LocalDate, time: LocalTime): string => `${longDate(date)}, ${time}`;
export const dotDate = (date: LocalDate): string => {
  const [y, m, d] = parts(date);
  return `${pad(d)}.${pad(m)}.${y}`;
};
export const slashDate = (date: LocalDate): string => dateToTyped(date);

/** One calendar month on, held to the last day of a shorter month. */
export const oneMonthOn = (date: LocalDate): LocalDate => {
  const [y, m, d] = parts(date);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(d, last))}`;
};

export const isoWeekOf = (date: LocalDate): string => {
  const offset = (weekdayIndex(date) + 6) % 7;
  const thursday = addDays(date, 3 - offset);
  const year = parts(thursday)[0];
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${pad(week)}`;
};
export const mondayOfIsoWeek = (week: string): LocalDate | null => {
  const found = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!found) return null;
  const year = Number(found[1]);
  const number = Number(found[2]);
  const jan4 = `${year}-01-04`;
  const monday = addDays(addDays(jan4, -((weekdayIndex(jan4) + 6) % 7)), (number - 1) * 7);
  return number >= 1 && isoWeekOf(monday) === week ? monday : null;
};
export const mondayOf = (date: LocalDate): LocalDate => addDays(date, -((weekdayIndex(date) + 6) % 7));
