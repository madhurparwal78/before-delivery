import type { EntryStanding, RankChange, RunView, StandingRow, View } from "../../shared/api.js";
import { type RunOutcome, type RunStatus, hasTime } from "../../shared/lifecycle.js";
import { formatFactor, formatMs, rankChangeText } from "../../shared/rules.js";
import { type Db, rows } from "../db.js";

export interface RunRow {
  id: number;
  registration_id: number;
  run_number: number;
  status: RunStatus;
  outcome: RunOutcome | null;
  raw_ms: number | null;
  cones: number | null;
  adjusted_ms: number | null;
  indexed_ms: number | null;
  factor_bp: number | null;
  committed_at: Date | null;
  committed_by: number | null;
  committed_by_name: string | null;
}

export function toRunView(run: RunRow): RunView {
  return {
    id: run.id,
    runNumber: run.run_number,
    status: run.status,
    outcome: run.outcome,
    rawTime: run.raw_ms === null ? null : formatMs(run.raw_ms),
    cones: run.cones,
    adjustedTime: run.adjusted_ms === null ? null : formatMs(run.adjusted_ms),
    indexedTime: run.indexed_ms === null ? null : formatMs(run.indexed_ms),
    factor: run.factor_bp === null ? null : formatFactor(run.factor_bp),
    committedAt: run.committed_at === null ? null : run.committed_at.toISOString(),
    committedBy:
      run.committed_by !== null && run.committed_by_name !== null
        ? { id: run.committed_by, name: run.committed_by_name }
        : null,
  };
}

interface Entry {
  registrationId: number;
  driverId: number;
  carNumber: number;
  classCode: string;
  driverName: string;
  carDescription: string;
  runHeat: number;
  checkedIn: boolean;
  runs: RunRow[];
  lastChange: { runNumber: number; at: Date; rankChange: RankChange } | null;
}

interface RegistrationRow {
  registration_id: number;
  user_id: number;
  car_number: number;
  class_code: string;
  car_description: string;
  run_heat: number;
  checked_in_at: Date | null;
  driver_name: string;
  last_change_run: number | null;
  last_change_at: Date | null;
  last_change_rank: RankChange | null;
}

export async function loadEntries(db: Db, eventId: number): Promise<Entry[]> {
  const registrations = await rows<RegistrationRow>(
    db,
    `select r.id as registration_id, r.user_id, r.car_number, r.class_code, r.car_description, r.run_heat, r.checked_in_at,
            u.name as driver_name, r.last_change_run, r.last_change_at, r.last_change_rank
       from registrations r join users u on u.id = r.user_id
      where r.event_id = $1 order by r.class_code, r.car_number`,
    [eventId],
  );
  const runs = await rows<RunRow>(
    db,
    `select ru.id, ru.registration_id, ru.run_number, ru.status, ru.outcome, ru.raw_ms, ru.cones, ru.adjusted_ms,
            ru.indexed_ms, ru.factor_bp, ru.committed_at, ru.committed_by, cu.name as committed_by_name
       from runs ru
       join registrations r on r.id = ru.registration_id
       left join users cu on cu.id = ru.committed_by
      where r.event_id = $1 order by ru.registration_id, ru.run_number`,
    [eventId],
  );
  return registrations.map((r) => ({
    registrationId: r.registration_id,
    driverId: r.user_id,
    carNumber: r.car_number,
    classCode: r.class_code,
    driverName: r.driver_name,
    carDescription: r.car_description,
    runHeat: r.run_heat,
    checkedIn: r.checked_in_at !== null,
    runs: runs.filter((run) => run.registration_id === r.registration_id),
    lastChange:
      r.last_change_run !== null && r.last_change_at !== null && r.last_change_rank !== null
        ? { runNumber: r.last_change_run, at: r.last_change_at, rankChange: r.last_change_rank }
        : null,
  }));
}

export interface Ranked extends Entry {
  bestAdjustedMs: number | null;
  bestIndexedMs: number | null;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
}

function best(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

/** Positions by ascending time; ties go to the lower car number, then the class code in alphabetical order. */
function assign(entries: Ranked[], time: (e: Ranked) => number | null): Map<number, number> {
  const timed = entries.flatMap((entry) => {
    const value = time(entry);
    return value === null ? [] : [{ entry, value }];
  });
  timed.sort(
    (a, b) =>
      a.value - b.value ||
      a.entry.carNumber - b.entry.carNumber ||
      a.entry.classCode.localeCompare(b.entry.classCode, "en"),
  );
  return new Map(timed.map(({ entry }, index) => [entry.registrationId, index + 1]));
}

export function rankEntries(entries: Entry[]): Ranked[] {
  const timed = entries.map<Ranked>((entry) => {
    const counted = entry.runs.filter((run) => hasTime(run.status, run.outcome));
    return {
      ...entry,
      bestAdjustedMs: best(counted.map((run) => run.adjusted_ms)),
      bestIndexedMs: best(counted.map((run) => run.indexed_ms)),
      position: null,
      classPosition: null,
      rawPosition: null,
    };
  });
  const overall = assign(timed, (e) => e.bestIndexedMs);
  const raw = assign(timed, (e) => e.bestAdjustedMs);
  const inClass = new Map<number, number>();
  for (const code of new Set(timed.map((e) => e.classCode))) {
    const members = timed.filter((e) => e.classCode === code);
    for (const [id, place] of assign(members, (e) => e.bestAdjustedMs)) inClass.set(id, place);
  }
  return timed.map((e) => ({
    ...e,
    position: overall.get(e.registrationId) ?? null,
    classPosition: inClass.get(e.registrationId) ?? null,
    rawPosition: raw.get(e.registrationId) ?? null,
  }));
}

export function entryStanding(entry: Ranked): EntryStanding {
  return {
    registrationId: entry.registrationId,
    carNumber: entry.carNumber,
    classCode: entry.classCode,
    position: entry.position,
    classPosition: entry.classPosition,
    rawPosition: entry.rawPosition,
    bestAdjusted: entry.bestAdjustedMs === null ? null : formatMs(entry.bestAdjustedMs),
    bestIndexed: entry.bestIndexedMs === null ? null : formatMs(entry.bestIndexedMs),
  };
}

type Positions = { [view in View]: number | null };

function positionsOf(entry: Ranked): Positions {
  return { indexed: entry.position, class: entry.classPosition, raw: entry.rawPosition };
}

export function findEntry(ranked: Ranked[], registrationId: number): Ranked {
  const entry = ranked.find((e) => e.registrationId === registrationId);
  if (!entry) throw new Error(`registration ${registrationId} is not in the standings`);
  return entry;
}

/** The badge texts for one entry, comparing its positions just before a change with just after. */
export function rankChange(before: Ranked, after: Ranked): RankChange {
  const was = positionsOf(before);
  const now = positionsOf(after);
  return {
    indexed: rankChangeText(was.indexed, now.indexed),
    class: rankChangeText(was.class, now.class),
    raw: rankChangeText(was.raw, now.raw),
  };
}

/** Ranked entries first in the view's order, then entries with no valid time by class code then car number. */
export function orderForView(ranked: Ranked[], view: View, classCode: string | null): Ranked[] {
  const kept = classCode === null ? ranked : ranked.filter((e) => e.classCode === classCode);
  const place = (entry: Ranked): number | null => positionsOf(entry)[view];
  const code = (a: Ranked, b: Ranked): number => a.classCode.localeCompare(b.classCode, "en");
  const timed = kept.flatMap((entry) => {
    const value = place(entry);
    return value === null ? [] : [{ entry, value }];
  });
  timed.sort((a, b) => (view === "class" ? code(a.entry, b.entry) || a.value - b.value : a.value - b.value));
  const untimed = kept.filter((entry) => place(entry) === null).sort((a, b) => code(a, b) || a.carNumber - b.carNumber);
  return [...timed.map(({ entry }) => entry), ...untimed];
}

export function standingRow(entry: Ranked): StandingRow {
  return {
    ...entryStanding(entry),
    driverName: entry.driverName,
    carDescription: entry.carDescription,
    lastChange: entry.lastChange
      ? { runNumber: entry.lastChange.runNumber, at: entry.lastChange.at.toISOString(), rankChange: entry.lastChange.rankChange }
      : null,
    runs: entry.runs.map(toRunView),
  };
}
