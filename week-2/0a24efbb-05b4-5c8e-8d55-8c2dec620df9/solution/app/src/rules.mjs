import { fieldRefusal, refuse } from "./http.mjs";
import { addDays, daysBetween, instantOf } from "./time.mjs";

export const CORRECTION_TYPES = ["missed_in", "missed_out", "offsite", "whole_day", "night_shift"];
export const STATES = ["pending", "approved", "rejected", "cancelled"];

/** Which claimed times each correction type requires. */
export function requiredTimes(type) {
  if (type === "missed_in") return ["claimed_in"];
  if (type === "missed_out") return ["claimed_out"];
  return ["claimed_in", "claimed_out"];
}

/** The business date a claimed sign-out falls on: the following day for a night shift. */
export function signOutDay(type, day) {
  return type === "night_shift" ? addDays(day, 1) : day;
}

/** The window counts back from `seeded_on`: that day and the `lookback` days before it are inside. */
export function windowRefusal(day, seededOn, lookback) {
  const back = daysBetween(day, seededOn);
  return back >= 0 && back <= lookback ? null : refuse(422, `That day is outside the ${lookback} day correction window.`);
}

/** Claimed instants of a request, or the 422 for a time the clocks skip (claimed_in checked first). */
export function claimedInstants({ correction_type: type, day, claimed_in: claimedIn, claimed_out: claimedOut }) {
  const found = {};
  for (const [field, clock, on] of [["claimed_in", claimedIn, day], ["claimed_out", claimedOut, signOutDay(type, day)]]) {
    if (clock == null) continue;
    found[field] = instantOf(on, clock);
    if (found[field] === null) {
      throw fieldRefusal(422, field, `${clock} does not occur on ${on} in Kestrel Works time.`);
    }
  }
  return found;
}

/**
 * The claim against the recorded punches of that day and the days either side, in the published order.
 * `rows` maps a business date to `{recorded_in, recorded_out}` (Date or null).
 */
export function claimAgainstRecord(request, rows) {
  const { correction_type: type, day } = request;
  const { claimed_in: signIn, claimed_out: signOut } = claimedInstants(request);
  const ms = (value) => (value ? value.getTime() : null);
  const previous = addDays(day, -1);
  const next = addDays(day, 1);
  const here = { in: ms(rows[day]?.recorded_in), out: ms(rows[day]?.recorded_out) };
  const before = ms(rows[previous]?.recorded_out);
  const after = ms(rows[next]?.recorded_in);
  if (type === "missed_in" && here.out !== null && !(signIn < here.out)) {
    throw fieldRefusal(422, "claimed_in", "The claimed sign-in must come before the recorded sign-out.");
  }
  if (signIn !== undefined && before !== null && signIn < before) {
    throw fieldRefusal(422, "claimed_in", `A sign-in cannot come before the sign-out recorded on ${previous}.`);
  }
  if (type === "missed_out" && here.in !== null && !(signOut > here.in)) {
    throw fieldRefusal(422, "claimed_out", "The claimed sign-out must come after the recorded sign-in.");
  }
  if (type === "night_shift" && after !== null && signOut > after) {
    throw fieldRefusal(422, "claimed_out", `A night shift cannot end after the sign-in recorded on ${next}.`);
  }
  return { signIn, signOut };
}

/** The leave kind a reader sees: a manager reading a report's request sees sickness only as an absence. */
export function projectLeaveKind(kind, reader, raiserId) {
  return reader.role === "manager" && reader.id !== raiserId && kind === "sickness" ? "absence" : kind;
}

