// Infill: eligibility (shared by queueing, the holidays list and the lost-vessel move), geometry and the queue.
import type { Db } from "./db.js";
import { one, rows } from "./db.js";
import { centroidOf, CELL, gridOf, holidayJson } from "./coverage.js";
import { chordRange, directions, distance, dot, pointAt, vec, type Position } from "./geometry.js";
import type { HolidayRecord, MissionRecord, PlacedVessel, UserRecord } from "./records.js";
import { linkState, loadVessels, overdue } from "./vessels.js";

/** Eligible: has lines on this mission, afloat, Live and not overdue. */
export async function eligibleVessels(db: Db, missionId: string): Promise<PlacedVessel[]> {
  const onMission = new Set((await rows<{ vessel_id: string }>(db, "SELECT DISTINCT vessel_id FROM lines WHERE mission_id = $1 AND vessel_id IS NOT NULL", [missionId])).map((r) => r.vessel_id));
  return (await loadVessels(db)).filter((v) => onMission.has(v.id) && v.afloat && linkState(v.last_fix_received_at) === "Live" && !overdue(v));
}

/** The eligible vessel whose last fix is closest to `point`; ties to the alphabetically first name. */
export function nearestOf(candidates: PlacedVessel[], point: Position, except?: string): PlacedVessel | null {
  let best: PlacedVessel | null = null;
  let bestDistance = Infinity;
  for (const v of candidates) {
    if (v.id === except || !v.last_fix_t) continue;
    const d = distance({ easting: v.last_easting, northing: v.last_northing }, point);
    if (d < bestDistance || (d === bestDistance && best && v.name.localeCompare(best.name) < 0)) {
      best = v;
      bestDistance = d;
    }
  }
  return best;
}

/** The infill line across a holiday: along the azimuth through the centroid's offset, 10 m past each end, clipped. */
export function infillGeometry(mission: MissionRecord, cells: [number, number][]): { start: Position; end: Position } {
  const area: Position[] = mission.survey_area;
  const grid = gridOf(area);
  const { along, across } = directions(mission.line_azimuth_deg);
  const offset = dot(vec(centroidOf(grid, cells)), across);
  const alongs = cells.map(([c, r]) => dot([grid.origin.easting + CELL * c + 2.5, grid.origin.northing + CELL * r + 2.5], along));
  const [t0, t1] = chordRange(area.map(vec), across, along, offset) ?? [Math.min(...alongs), Math.max(...alongs)];
  const from = Math.max(Math.min(...alongs) - 10, t0);
  const to = Math.min(Math.max(...alongs) + 10, t1);
  return { start: pointAt(across, along, offset, from), end: pointAt(across, along, offset, to) };
}

export const midpoint = (a: Position, b: Position): Position => ({ easting: (a.easting + b.easting) / 2, northing: (a.northing + b.northing) / 2 });

/** Puts an infill line at the end of a vessel's queue on its mission. */
export async function appendToQueue(db: Db, lineId: string, missionId: string, vesselId: string): Promise<void> {
  const last = await one<{ p: number | null }>(db, "SELECT max(queue_pos) AS p FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned'", [missionId, vesselId]);
  await db.query("UPDATE lines SET vessel_id = $2, queue_pos = $3 WHERE id = $1", [lineId, vesselId, (last?.p ?? 0) + 1]);
}

/** A vessel's infill queue on a mission: its Assigned infill lines in run order. */
export async function queueOf(db: Db, missionId: string, vesselId: string): Promise<string[]> {
  return (await rows<{ id: string }>(db,
    "SELECT id FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned' ORDER BY queue_pos, sort_key",
    [missionId, vesselId])).map((r) => r.id);
}

/** A holiday record: staff see its nearest eligible vessel, client reviewers never do. */
export async function holidayRecord(db: Db, mission: MissionRecord, h: HolidayRecord, viewer: UserRecord, eligible?: PlacedVessel[]): Promise<Record<string, unknown>> {
  const grid = gridOf(mission.survey_area);
  let nearest: { id: string; name: string } | null = null;
  if (viewer.role !== "client_reviewer" && h.status !== "Closed") {
    const g = infillGeometry(mission, h.cells);
    const v = nearestOf(eligible ?? (await eligibleVessels(db, mission.id)), midpoint(g.start, g.end));
    nearest = v ? { id: v.id, name: v.name } : null;
  }
  return holidayJson(h, grid, nearest);
}
