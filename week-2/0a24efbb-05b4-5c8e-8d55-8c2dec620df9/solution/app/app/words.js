import { businessDate, clockOf } from "../src/time.mjs";

// The brief's public names for the domain's codes, and how instants read on screen (Kestrel Works time).

export const TYPE_LABELS = {
  missed_in: "Sign in was not recorded",
  missed_out: "Sign out was not recorded",
  offsite: "Worked away from the workplace",
  whole_day: "Whole day worked but not recorded",
  night_shift: "Night shift recorded against the wrong day",
};

export const STATE_WORDS = { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };
export const STATE_GLYPHS = { pending: "bar", approved: "check", rejected: "cross", cancelled: "slash" };
export const ROLE_LABELS = { employee: "Employee", manager: "Manager", admin: "People operations" };
export const LEAVE_LABELS = { annual: "Annual leave", sickness: "Sickness", absence: "Absence" };
export const VERB_WORDS = {
  approved: "Approved",
  rejected: "Rejected",
  policy_saved: "Saved the policy",
  share_mint: "Shared a month",
  share_revoke: "Revoked a shared month",
};

export const MARKS = [
  ["recorded", "Attendance recorded", "check"],
  ["incomplete", "Attendance incomplete", "clock"],
  ["leave_approved", "Leave approved", "calendar"],
  ["leave_pending", "Leave pending", "bar"],
  ["waiting", "Correction waiting", "bell"],
];

/** A punch as `HH:MM`, with its date when it falls on another business day than `day`. */
export function punch(instant, day) {
  if (!instant) return null;
  const on = businessDate(instant);
  return on === day ? clockOf(instant) : `${clockOf(instant)} on ${on}`;
}

/** A punch in a queue row, where the row's one height leaves room for the time alone; the pane gives its date. */
export const rowPunch = (instant) => instant && clockOf(instant);

/** A moment as `YYYY-MM-DD HH:MM` in Kestrel Works time. */
export function moment(instant) {
  return `${businessDate(instant)} ${clockOf(instant)}`;
}

export function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
