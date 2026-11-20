// The brief's display formats. Instants arrive at the Europe/London offset, so
// clock times are read straight from the string and never through a local Date.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const SHIFT_LABELS = { early: "Early", late: "Late", night: "Night" };
export const SHIFTS = ["early", "late", "night"];
export const TYPE_LABELS = {
  annual: "Annual leave",
  unpaid: "Unpaid leave",
  compassionate: "Compassionate leave",
};
export const STATUS_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  escalated: "Escalated",
  cover_pending: "Cover pending",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
export const SICKNESS_LABELS = {
  reported: "Reported",
  fit_note_required: "Fit note required",
  evidenced: "Evidenced",
  closed: "Closed",
};
export const SKILL_LABELS = { senior: "Senior", carer: "Carer" };

function parts(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

export function formatDate(isoDate) {
  const { year, month, day, weekday } = parts(isoDate);
  return `${DAYS[weekday]} ${day} ${MONTHS[month - 1]} ${year}`;
}

export function shiftLabel(isoDate, shift) {
  const { month, day, weekday } = parts(isoDate);
  return `${DAYS[weekday]} ${day} ${MONTHS[month - 1]} ${SHIFT_LABELS[shift]}`;
}

export function shortLabel(isoDate, shift) {
  const { weekday } = parts(isoDate);
  return `${DAYS[weekday]} ${SHIFT_LABELS[shift]}`;
}

export function dayName(isoDate) {
  return DAYS[parts(isoDate).weekday];
}

export function dayHeading(isoDate) {
  const { month, day, weekday } = parts(isoDate);
  return `${DAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

export function monthLabel(period) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function clockTime(instant) {
  return instant.slice(11, 16);
}

export function addDays(isoDate, days) {
  const { year, month, day } = parts(isoDate);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

export function isoWeekOf(isoDate) {
  const { year, month, day } = parts(isoDate);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function mondayOf(isoDate) {
  const { year, month, day } = parts(isoDate);
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(isoDate, -weekday);
}
