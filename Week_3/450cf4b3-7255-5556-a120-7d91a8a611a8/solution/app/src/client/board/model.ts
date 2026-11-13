// Pure Board rules: the URL's view, which bookings the ticket column lists, door actions after a
// door answer, and the first failing field of a refused claim.

import type { Booking, DoorAction, DoorEntry, Interval, Station } from "../../shared/api.js";
import { clockText, isDate, isSpan, parseClock } from "../../shared/clock.js";
import { dayOf } from "../kitchen.js";

export interface View {
  date: string;
  from: number;
  to: number;
}

const DEFAULT_FROM = 9 * 60;
const DEFAULT_TO = 12 * 60;

/** The date and span of the URL; each falls back to its default on its own when missing or invalid. */
export function readView(search: string, today: string): { view: View; canonical: boolean } {
  const params = new URLSearchParams(search);
  const rawDate = params.get("date");
  const date = rawDate !== null && isDate(rawDate) ? rawDate : today;
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const from = rawFrom === null ? null : parseClock(rawFrom);
  const to = rawTo === null ? null : parseClock(rawTo);
  const spanOk = from !== null && to !== null && isSpan(from, to);
  return { view: { date, from: spanOk ? from : DEFAULT_FROM, to: spanOk ? to : DEFAULT_TO }, canonical: rawDate === date && spanOk };
}

export function boardUrl(view: View): string {
  return `/board?date=${view.date}&from=${clockText(view.from)}&to=${clockText(view.to)}`;
}

export const expiredHold = (b: Booking): boolean => b.status === "cancelled" && b.cancelReason === "hold_expired";

/** The ticket column's rule: starts on or after the shown date, or can still be moved; a lapsed hold never lists. */
export function listed(b: Booking, date: string): boolean {
  return !expiredHold(b) && (dayOf(b.start) >= date || b.movable);
}

/** The door actions open right after a door action succeeded: only a checked-in booking can check out. */
function actionsAfter(status: Booking["status"]): DoorAction[] {
  return status === "checked_in" ? ["check_out"] : [];
}

/** The door entry right after a door action's own answer. */
export function doorEntryFrom(entry: DoorEntry, b: Booking): DoorEntry {
  return { ...entry, status: b.status, actions: actionsAfter(b.status), doorLog: b.doorLog ?? entry.doorLog, cleanupNote: b.cleanupNote ?? entry.cleanupNote };
}

const FIELD_ORDER = ["stationId", "shelfId", "start", "end"] as const;

/** The sentence of the first failing field in the order stationId, shelfId, start, end, as the server sent it. */
export function firstFieldSentence(fields: Readonly<Record<string, string>> | undefined): string | null {
  if (!fields) return null;
  for (const name of FIELD_ORDER) {
    const sentence = fields[name];
    if (sentence) return sentence;
  }
  return Object.values(fields)[0] ?? null;
}

const same = (a: Interval, b: Pick<Booking, "start" | "end" | "bufferEnd">): boolean => a.start === b.start && a.end === b.end && a.bufferEnd === b.bufferEnd;

/** The floor with a booking's interval added to the stations it occupies (when it falls on the floor's date). */
export function withInterval(stations: readonly Station[], date: string, b: Booking): Station[] {
  if (dayOf(b.start) !== date) return [...stations];
  const occupied = b.shelfId ? [b.stationId, b.shelfId] : [b.stationId];
  return stations.map((s) => (occupied.includes(s.id)
    ? { ...s, intervals: [...s.intervals, { start: b.start, end: b.end, bufferEnd: b.bufferEnd, mine: true }] }
    : s));
}

/** The floor without one booking's interval (one match per station), when it falls on the floor's date. */
export function withoutInterval(stations: readonly Station[], date: string, b: Booking): Station[] {
  if (dayOf(b.start) !== date) return [...stations];
  const occupied = b.shelfId ? [b.stationId, b.shelfId] : [b.stationId];
  return stations.map((s) => {
    if (!occupied.includes(s.id)) return s;
    const at = s.intervals.findIndex((i) => same(i, b));
    return at < 0 ? s : { ...s, intervals: s.intervals.filter((_, index) => index !== at) };
  });
}
