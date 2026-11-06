// Display formats from the brief (Business rules: Formats). Times are shown in Europe/London.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
export const SHIFT_NAMES = { early: "Early", late: "Late", night: "Night" };
export const TYPE_LABELS = { annual: "Annual leave", unpaid: "Unpaid leave", compassionate: "Compassionate leave" };
export const STATUS_LABELS = {
  draft: "Draft", submitted: "Submitted", escalated: "Escalated", cover_pending: "Cover pending",
  approved: "Approved", declined: "Declined", withdrawn: "Withdrawn", cancelled: "Cancelled",
};
export const SICKNESS_LABELS = {
  reported: "Reported", fit_note_required: "Fit note required", evidenced: "Evidenced", closed: "Closed",
};
export const SKILL_LABELS = { senior: "Senior", carer: "Carer" };

const LONDON = "Europe/London";
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const wall = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  second: "2-digit", hourCycle: "h23",
});

function day(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const d = day(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso) {
  const d = day(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dayCaption(iso) {
  const d = day(iso);
  return [WEEKDAYS[d.getUTCDay()], `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`];
}

export function shiftLabel(iso, shift) {
  const d = day(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${SHIFT_NAMES[shift]}`;
}

export function monthLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function hm(instant) {
  return clock.format(new Date(instant));
}

export function span(request) {
  return `${fmtDate(request.start_date)} to ${fmtDate(request.end_date)}`;
}

// A decimal string rounded half up to two places, without binary floating point.
export function twoPlaces(value) {
  const [whole, fraction = ""] = String(value).split(".");
  const digits = `${fraction}000`;
  let cents = BigInt(whole) * 100n + BigInt(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function isoWeek(iso) {
  const thursday = day(iso);
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / 86400000 / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function mondayOf(iso) {
  return addDays(iso, -((day(iso).getUTCDay() + 6) % 7));
}

function londonOffsetMinutes(utcMs) {
  const parts = Object.fromEntries(wall.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// "2026-10-25T01:30" typed as London wall time -> ISO 8601 with the London offset in force then.
export function londonInstant(local) {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = londonOffsetMinutes(guess);
  offset = londonOffsetMinutes(guess - offset * 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${time.slice(0, 5)}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// An instant -> "YYYY-MM-DDTHH:MM" in London wall time, for a datetime-local field.
export function londonLocal(instant) {
  const parts = Object.fromEntries(wall.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
