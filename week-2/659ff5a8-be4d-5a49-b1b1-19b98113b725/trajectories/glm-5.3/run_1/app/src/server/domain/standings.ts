// Standings computation: positions, row order and best times, decided here.
import { entryTieBreak } from "./states.js";
import { fmtTime } from "./times.js";
import type { RegistrationRow, RunDbRow, StandingsRow, RunObj } from "./types.js";
import type { Db } from "../db.js";
import type { EventRow } from "./types.js";
import { mapRun } from "./repo.js";

export interface StandingsEntry extends StandingsRow {
  driver_id: string;
  run_heat: number;
  checked_in: boolean;
}

interface Computed {
  bestAdjusted: string | null;
  bestIndexed: string | null;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
}

/** Best times come from runs with outcome "time" and status committed or corrected. */
export function bestTimes(runs: RunDbRow[]): { bestAdjusted: string | null; bestIndexed: string | null } {
  let bestAdj: string | null = null;
  let bestIdx: string | null = null;
  for (const run of runs) {
    if (run.outcome !== "time" || (run.status !== "committed" && run.status !== "corrected")) continue;
    const adj = fmtTime(run.adjusted_time);
    const idx = fmtTime(run.indexed_time);
    if (adj !== null && (bestAdj === null || adj < bestAdj)) bestAdj = adj;
    if (idx !== null && (bestIdx === null || idx < bestIdx)) bestIdx = idx;
  }
  return { bestAdjusted: bestAdj, bestIndexed: bestIdx };
}

export function computePositions(
  entries: { registrationId: string; carNumber: number; classCode: string; bestAdjusted: string | null; bestIndexed: string | null }[],
): Map<string, Computed> {
  const ranked = entries.filter((e) => e.bestIndexed !== null);
  ranked.sort((a, b) => {
    const aIdx = a.bestIndexed as string;
    const bIdx = b.bestIndexed as string;
    if (aIdx !== bIdx) return aIdx < bIdx ? -1 : 1;
    return entryTieBreak(a, b);
  });
  const map = new Map<string, Computed>();
  ranked.forEach((e, i) => {
    const existing = map.get(e.registrationId) ?? emptyComputed();
    existing.position = i + 1;
    map.set(e.registrationId, existing);
  });

  // Raw positions rank by best adjusted across the event.
  const rawRanked = entries.filter((e) => e.bestAdjusted !== null);
  rawRanked.sort((a, b) => {
    const aAdj = a.bestAdjusted as string;
    const bAdj = b.bestAdjusted as string;
    if (aAdj !== bAdj) return aAdj < bAdj ? -1 : 1;
    return entryTieBreak(a, b);
  });
  rawRanked.forEach((e, i) => {
    const existing = map.get(e.registrationId) ?? emptyComputed();
    existing.rawPosition = i + 1;
    map.set(e.registrationId, existing);
  });

  // Class positions rank by best adjusted within each class.
  const byClass = new Map<string, typeof rawRanked>();
  for (const e of rawRanked) {
    const list = byClass.get(e.classCode) ?? [];
    list.push(e);
    byClass.set(e.classCode, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => {
      const aAdj = a.bestAdjusted as string;
      const bAdj = b.bestAdjusted as string;
      if (aAdj !== bAdj) return aAdj < bAdj ? -1 : 1;
      return entryTieBreak(a, b);
    });
    list.forEach((e, i) => {
      const existing = map.get(e.registrationId) ?? emptyComputed();
      existing.classPosition = i + 1;
      map.set(e.registrationId, existing);
    });
  }

  for (const e of entries) if (!map.has(e.registrationId)) map.set(e.registrationId, emptyComputed());
  return map;
}

/** Load every entry with its runs and compute positions. */
export async function loadEntries(db: Db, event: EventRow): Promise<StandingsEntry[]> {
  const regRows = await db.query(
    `SELECT r.*, u.name AS driver_name, u.email AS driver_email
     FROM registrations r JOIN users u ON u.id = r.driver_id
     WHERE r.event_id = $1 ORDER BY r.class_code, r.car_number`,
    [event.id],
  );
  const entries: StandingsEntry[] = [];
  for (const row of regRows) {
    const reg = row as unknown as RegistrationRow & { run_heat: number };
    const runRows = await db.query(
      `SELECT ru.*, u.name AS committed_by_name FROM runs ru
       LEFT JOIN users u ON u.id = ru.committed_by
       WHERE ru.registration_id = $1 ORDER BY ru.run_number`,
      [reg.id],
    );
    const runs = runRows.map(mapRun);
    const best = bestTimes(runs);
    entries.push({
      registrationId: reg.id,
      carNumber: reg.car_number,
      classCode: reg.class_code,
      driverName: reg.driver_name,
      carDescription: reg.car_description,
      position: null,
      classPosition: null,
      rawPosition: null,
      bestAdjusted: best.bestAdjusted,
      bestIndexed: best.bestIndexed,
      lastChange: null,
      runs: runs.map((r) => ({
        id: r.id,
        runNumber: r.run_number,
        status: r.status as RunObj["status"],
        outcome: r.outcome as RunObj["outcome"],
        rawTime: fmtTime(r.raw_time),
        cones: r.cones,
        adjustedTime: fmtTime(r.adjusted_time),
        indexedTime: fmtTime(r.indexed_time),
        factor: r.factor,
        committedAt: r.committed_at ? new Date(r.committed_at).toISOString() : null,
        committedBy: r.committed_by_name ? { id: "", name: r.committed_by_name } : null,
      })),
      driver_id: reg.driver_id,
      run_heat: reg.run_heat,
      checked_in: reg.checked_in_at !== null,
    });
  }
  const positions = computePositions(entries.map((e) => ({
    registrationId: e.registrationId,
    carNumber: e.carNumber,
    classCode: e.classCode,
    bestAdjusted: e.bestAdjusted,
    bestIndexed: e.bestIndexed,
  })));
  for (const e of entries) {
    const p = positions.get(e.registrationId);
    if (p) {
      e.position = p.position;
      e.classPosition = p.classPosition;
      e.rawPosition = p.rawPosition;
    }
  }
  return entries;
}

/** Full standings for the API, including each entry's latest rank-change text. */
export async function computeStandings(db: Db, event: EventRow): Promise<StandingsEntry[]> {
  const entries = await loadEntries(db, event);
  const changes = await db.query(
    `SELECT registration_id, run_number, at, indexed, class, raw FROM run_rank_changes`,
  );
  for (const e of entries) {
    const mine = changes.filter((c) => c.registration_id === e.registrationId);
    if (mine.length === 0) continue;
    const latest = mine.reduce((a, b) => (new Date(a.at as string) >= new Date(b.at as string) ? a : b));
    e.lastChange = {
      runNumber: latest.run_number as number,
      at: new Date(latest.at as string).toISOString(),
      rankChange: {
        indexed: latest.indexed as string,
        class: latest.class as string,
        raw: latest.raw as string,
      },
    };
  }
  return entries;
}

function emptyComputed(): Computed {
  return { bestAdjusted: null, bestIndexed: null, position: null, classPosition: null, rawPosition: null };
}

/** Unranked entries come after ranked ones, by class code then car number. */
export function orderRows(
  view: "indexed" | "class" | "raw",
  rows: StandingsEntry[],
  positions: Map<string, Computed>,
): StandingsEntry[] {
  const withPos = rows.map((r) => ({ ...r, ...positions.get(r.registrationId)! }));
  const ranked = withPos.filter((r) => {
    if (view === "indexed") return r.position !== null;
    if (view === "raw") return r.rawPosition !== null;
    return r.classPosition !== null;
  });
  const unranked = withPos.filter((r) => !ranked.includes(r));
  unranked.sort((a, b) => {
    if (a.classCode !== b.classCode) return a.classCode < b.classCode ? -1 : 1;
    return a.carNumber - b.carNumber;
  });
  if (view === "indexed") ranked.sort((a, b) => (a.position as number) - (b.position as number));
  else if (view === "raw") ranked.sort((a, b) => (a.rawPosition as number) - (b.rawPosition as number));
  else
    ranked.sort((a, b) => {
      if (a.classCode !== b.classCode) return a.classCode < b.classCode ? -1 : 1;
      return (a.classPosition as number) - (b.classPosition as number);
    });
  return [...ranked, ...unranked];
}
