// Pilot eligibility: licence cover and the rest verdict (rest, night rest, rota days), counted in
// real elapsed time between duty instants.
import { addDays, HOUR_MS, inNightWindow, portDate, portMinuteOfDay, portStamp } from "../../shared/portTime.js";
import type { TurnEntry } from "../../shared/types.js";
import type { DutyRecord, PilotRecord } from "../store.js";

const LICENCE_CLASSES: Readonly<Record<string, { length_m: number; draught_mm: number }>> = {
  A: { length_m: 300, draught_mm: 13500 },
  B: { length_m: 230, draught_mm: 11500 },
  C: { length_m: 160, draught_mm: 8000 },
};

const LONG_DUTY_MS = 7 * HOUR_MS;
const NIGHT_RUN_LIMIT = 3;
const NIGHT_REST_MS = 12 * HOUR_MS;
const ROTA_DAY_LIMIT = 15;

const REST_REASONS: readonly string[] = ["rest", "night_rest", "rota_days"];

interface Duty {
  id: string;
  start: number;
  end: number;
}

/** Minimum rest after a duty: 10 hours after one of 7 hours or more, otherwise 6 hours. */
const minimumRestMs = (duty: Duty): number => (duty.end - duty.start >= LONG_DUTY_MS ? 10 : 6) * HOUR_MS;

const licenceCovers = (licenceClass: string, lengthM: number, draughtMm: number): boolean => {
  const cover = LICENCE_CLASSES[licenceClass];
  return cover !== undefined && lengthM <= cover.length_m && draughtMm <= cover.draught_mm;
};

function restBreached(duty: Duty, others: readonly Duty[]): boolean {
  return others.some((other) =>
    other.start < duty.start
      ? duty.start - other.end < minimumRestMs(other)
      : other.start - duty.end < minimumRestMs(duty),
  );
}

/** The night a duty belongs to, or null by day: a boarding from 00:00 to 05:59 belongs to the previous date. */
function nightOf(duty: Duty): string | null {
  const minutes = portMinuteOfDay(duty.start);
  if (!inNightWindow(minutes)) return null;
  const date = portDate(duty.start);
  return minutes < 22 * 60 ? addDays(date, -1) : date;
}

/** Each third-or-later consecutive night duty followed by a duty with under 12 hours' rest, as `night->next`. */
function nightRestBreaches(duties: readonly Duty[]): Set<string> {
  const sorted = [...duties].sort((a, b) => a.start - b.start);
  const nights = new Set(sorted.map(nightOf).filter((n): n is string => n !== null));
  const breaches = new Set<string>();
  sorted.forEach((duty, index) => {
    const night = nightOf(duty);
    if (night === null) return;
    let run = 1;
    while (nights.has(addDays(night, -run))) run += 1;
    const next = sorted[index + 1];
    if (run >= NIGHT_RUN_LIMIT && next && next.start - duty.end < NIGHT_REST_MS) breaches.add(`${duty.id}->${next.id}`);
  });
  return breaches;
}

function rotaRun(duties: readonly Duty[], date: string): number {
  const dates = new Set(duties.map((d) => portDate(d.start)));
  let run = 1;
  for (let back = -1; dates.has(addDays(date, back)); back -= 1) run += 1;
  for (let ahead = 1; dates.has(addDays(date, ahead)); ahead += 1) run += 1;
  return run;
}

/** The rest-type reasons a candidate duty would breach against a pilot's other duties. */
function restReasons(candidate: Duty, others: readonly Duty[]): string[] {
  const reasons: string[] = [];
  if (restBreached(candidate, others)) reasons.push("rest");
  const before = nightRestBreaches(others);
  if ([...nightRestBreaches([...others, candidate])].some((b) => !before.has(b))) reasons.push("night_rest");
  if (rotaRun([...others, candidate], portDate(candidate.start)) > ROTA_DAY_LIMIT) reasons.push("rota_days");
  return reasons;
}

/** When the rest owed after the pilot's last duty ending by `instant` runs out, or null. */
export function restUntil(duties: readonly Duty[], instant: number): number | null {
  const previous = duties.filter((d) => d.end <= instant).sort((a, b) => a.end - b.end).pop();
  return previous ? previous.end + minimumRestMs(previous) : null;
}

interface MoveDuty {
  start: number;
  end: number;
  length_m: number;
  draught_mm: number;
}

/** The turn list for a move: each pilot's position, licence cover and rest verdict, in turn order. */
export function turnFor(
  move: MoveDuty,
  pilots: readonly PilotRecord[],
  dutiesOf: (pilotId: string) => readonly DutyRecord[],
): TurnEntry[] {
  const candidate: Duty = { id: "candidate", start: move.start, end: move.end };
  return [...pilots]
    .sort((a, b) => a.position - b.position)
    .map((pilot) => {
      const duties = dutiesOf(pilot.id);
      const reasons = [
        ...(licenceCovers(pilot.licence_class, move.length_m, move.draught_mm) ? [] : ["licence"]),
        ...restReasons(candidate, duties),
      ];
      const until = restUntil(duties, move.start);
      return {
        pilot_id: pilot.id,
        name: pilot.name,
        position: pilot.position,
        licence_class: pilot.licence_class,
        eligible: reasons.length === 0,
        reasons,
        rest_breach: reasons.some((r) => REST_REASONS.includes(r)),
        rest_until: until === null ? null : portStamp(until),
      };
    });
}
