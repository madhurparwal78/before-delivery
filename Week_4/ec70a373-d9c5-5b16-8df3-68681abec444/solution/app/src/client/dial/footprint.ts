// The claim footprint on one dial: which steps are open, how far a drag may reach, and where a keyed window lands.
import { BOOKING_STEP_MINUTES, spansOverlap } from "../../shared/rules.ts";
import type { SectorKind } from "../../shared/api.ts";
import type { WallMinutes } from "../../shared/time.ts";

const STEP = BOOKING_STEP_MINUTES;
const DAY = 1440;

export interface Occupied {
  kind: SectorKind;
  start: WallMinutes;
  end: WallMinutes;
  bookingId: string | null;
}

export interface ClaimWindow {
  start: WallMinutes;
  end: WallMinutes;
}

export interface DialRules {
  sectors: Occupied[];
  /** The station's sanitation buffer, the length of its `buffer` sectors. */
  buffer: number;
  /** Quarter hours the member can still spend. */
  available: number;
  /** Elapsed quarter hours of a window on this dial's date. */
  cost: (w: ClaimWindow) => number;
}

/** The sectors that block a window's footprint: the window itself plus the buffer straight after it. */
function blockers(rules: DialRules, w: ClaimWindow): Occupied[] {
  const windowEnd = w.end === w.start ? w.start + STEP : w.end;
  return rules.sectors.filter(
    (s) =>
      spansOverlap(w.start, windowEnd, s.start, s.end) ||
      (s.kind !== "nonexistent" && spansOverlap(windowEnd, windowEnd + rules.buffer, s.start, s.end)),
  );
}

export function isBlocked(rules: DialRules, w: ClaimWindow): boolean {
  return blockers(rules, w).length > 0;
}

export function isOpenStep(rules: DialRules, minutes: WallMinutes): boolean {
  return minutes >= 0 && minutes < DAY && !isBlocked(rules, { start: minutes, end: minutes });
}

export function earliestOpenStep(rules: DialRules): WallMinutes | null {
  for (let m = 0; m < DAY; m += STEP) if (isOpenStep(rules, m)) return m;
  return null;
}

/** The last End a claim from `start` may reach: before its buffer meets an occupied sector, by 24:00, within the balance. */
export function reachFrom(rules: DialRules, start: WallMinutes): WallMinutes {
  let end = start;
  while (end + STEP <= DAY) {
    const next = { start, end: end + STEP };
    if (isBlocked(rules, next) || rules.cost(next) > rules.available) break;
    end += STEP;
  }
  return end;
}

/** Occupied sectors joined to `seed` by touching or overlapping, as one run. */
function runAround(sectors: Occupied[], seed: Occupied[]): { start: number; end: number } {
  const members = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of sectors) {
      if (members.has(s)) continue;
      if ([...members].some((m) => s.start <= m.end && m.start <= s.end)) {
        members.add(s);
        grew = true;
      }
    }
  }
  const list = [...members];
  return { start: Math.min(...list.map((s) => s.start)), end: Math.max(...list.map((s) => s.end)) };
}

/** A Start key press: the whole window moves, jumping over the run in its way when blocked. */
export function moveStart(rules: DialRules, w: ClaimWindow, delta: number): ClaimWindow | null {
  const moved = { start: w.start + delta, end: w.end + delta };
  const zeroLength = w.start === w.end;
  if (moved.start < 0 || moved.end > DAY || (zeroLength && moved.start === DAY)) return null;
  const blocking = blockers(rules, moved);
  if (blocking.length === 0) return rules.cost(moved) <= rules.available ? moved : null;
  const later = delta > 0;
  const first = later
    ? blocking.reduce((a, b) => (b.start < a.start ? b : a))
    : blocking.reduce((a, b) => (b.end > a.end ? b : a));
  const seed = [first];
  for (;;) {
    const run = runAround(rules.sectors, seed);
    const landing = later ? run.end : run.start - rules.buffer - STEP;
    if (landing >= DAY || landing < 0) return null;
    const stillBlocked = blockers(rules, { start: landing, end: landing }).filter((s) => !seed.includes(s));
    if (blockers(rules, { start: landing, end: landing }).length === 0) return { start: landing, end: landing };
    if (stillBlocked.length === 0) return null;
    seed.push(...stillBlocked);
  }
}

/** An End key press: End alone moves, never below Start, never into a blocked footprint or past the balance. */
export function moveEnd(rules: DialRules, w: ClaimWindow, delta: number): ClaimWindow | null {
  const moved = { start: w.start, end: w.end + delta };
  if (moved.end < moved.start || moved.end > DAY) return null;
  if (isBlocked(rules, moved) || rules.cost(moved) > rules.available) return null;
  return moved;
}
