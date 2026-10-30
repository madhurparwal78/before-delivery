import { wallClock, zoneToday } from "../../shared/format.js";

// The shop-drawing review clock: five Hong Kong working days after the start day, with a 17:00 HKT
// cut-off (brief: Shop-drawing review clock). The one place the due date and overdue flag are decided.

const HOLIDAYS = new Set([
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-04", "2026-04-06", "2026-04-07",
  "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01", "2026-09-26", "2026-10-01", "2026-10-19", "2026-12-25",
  "2026-12-26",
  "2027-01-01", "2027-02-06", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-27", "2027-03-29", "2027-04-05",
  "2027-05-01", "2027-05-13", "2027-06-09", "2027-07-01", "2027-09-16", "2027-10-01", "2027-10-08", "2027-12-25",
  "2027-12-27",
]);
const REVIEW_WORKING_DAYS = 5;

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const nextDay = (day: string): string => iso(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000));

function isWorkingDay(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(day);
}

function nextWorkingDay(day: string): string {
  let next = nextDay(day);
  while (!isWorkingDay(next)) next = nextDay(next);
  return next;
}

/** `reviewDueOn` for a submission received at `receivedAt`. */
export function reviewDueOn(receivedAt: Date): string {
  const local = wallClock(receivedAt, "Asia/Hong_Kong");
  const receivedDay = zoneToday("Asia/Hong_Kong", receivedAt);
  const afterCutOff = local.hour > 17 || (local.hour === 17 && (local.minute > 0 || local.second > 0 || receivedAt.getUTCMilliseconds() > 0));
  let day = isWorkingDay(receivedDay) && !afterCutOff ? receivedDay : nextWorkingDay(receivedDay);
  for (let i = 0; i < REVIEW_WORKING_DAYS; i++) day = nextWorkingDay(day);
  return day;
}

/** Overdue while the latest submission still awaits its return and today in Hong Kong is after the due date. */
export const isOverdue = (dueOn: string, awaitingReview: boolean, today = zoneToday("Asia/Hong_Kong")): boolean =>
  awaitingReview && today > dueOn;
