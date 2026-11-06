import type pg from 'pg';
import { newId } from './http.js';
import { Position, infillGeometry, gridSpec } from './domain.js';

// Shared eligibility: a vessel is eligible when it has lines on this mission,
// is afloat, is Live and is not overdue.
export async function eligibleInfillVessels(c: pg.PoolClient, missionId: string): Promise<string[]> {
  const r = await c.query(`
    SELECT v.id, v.name
    FROM (
      SELECT DISTINCT vessel_id FROM lines WHERE mission_id = $1 AND vessel_id IS NOT NULL
    ) s
    JOIN vessels v ON v.id = s.vessel_id
    WHERE v.afloat = true AND v.hours_since_service <= v.service_interval_h
    ORDER BY v.name ASC
  `, [missionId]);
  const now = Date.now();
  const out: string[] = [];
  for (const row of r.rows) {
    const last = await c.query(`SELECT received_at FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [row.id]);
    if (last.rows.length === 0) continue;
    const age = (now - new Date(last.rows[0]!.received_at).getTime()) / 1000;
    if (age >= 10) continue; // not Live
    out.push(row.id as string);
  }
  return out;
}

export async function nearestEligibleVessel(c: pg.PoolClient, missionId: string, point: Position): Promise<{ id: string; name: string } | null> {
  const ids = await eligibleInfillVessels(c, missionId);
  let best: { id: string; name: string; dist: number } | null = null;
  for (const id of ids) {
    const v = (await c.query(`SELECT name FROM vessels WHERE id = $1`, [id])).rows[0]!;
    const fix = await c.query(`SELECT easting, northing FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [id]);
    if (fix.rows.length === 0) continue;
    const f = fix.rows[0]!;
    const dist = Math.hypot(f.easting - point.easting, f.northing - point.northing);
    if (!best || dist < best.dist || (dist === best.dist && v.name < best.name)) {
      best = { id, name: v.name, dist };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export interface InfillCreate {
  lineId: string;
  holiday: { id: string; label: string; cells: { col: number; row: number }[]; centroid: Position };
  vessel: { id: string; name: string };
}

export async function createInfillLine(
  c: pg.PoolClient, missionId: string,
  holiday: { id: string; label: string; cells: { col: number; row: number }[]; centroid: Position },
  vessel: { id: string; name: string },
): Promise<InfillCreate> {
  const m = (await c.query(`SELECT survey_area, line_azimuth_deg FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  const area = m.survey_area as Position[];
  const spec = gridSpec(area);
  const geom = infillGeometry(holiday.cells, holiday.centroid, area, m.line_azimuth_deg as number, spec.origin);
  if (!geom) throw new Error('infill geometry failed');
  const length = Math.hypot(geom.end.easting - geom.start.easting, geom.end.northing - geom.start.northing);
  const countR = await c.query(
    `SELECT count(*)::int AS n FROM lines WHERE mission_id = $1 AND kind = 'infill'`, [missionId]);
  const n = countR.rows[0]!.n + 1;
  const label = `I${String(n).padStart(2, '0')}`;
  const lineId = newId('ln');
  const seqR = await c.query(`SELECT max(seq)::int AS mx FROM lines WHERE mission_id = $1`, [missionId]);
  const seq = (seqR.rows[0]?.mx ?? -1) + 1;
  const qseqR = await c.query(
    `SELECT max(queue_seq)::int AS mx FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill'`,
    [missionId, vessel.id]);
  const queueSeq = (qseqR.rows[0]?.mx ?? 0) + 1;
  await c.query(
    `INSERT INTO lines (id, mission_id, label, kind, status, vessel_id, start, "end", length_m, holiday_id, queue_seq, seq)
     VALUES ($1,$2,$3,'infill','Assigned',$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)`,
    [lineId, missionId, label, vessel.id, JSON.stringify(geom.start), JSON.stringify(geom.end), length, holiday.id, queueSeq, seq]
  );
  await c.query(`UPDATE holidays SET status = 'Queued', infill_line_id = $2 WHERE id = $1`, [holiday.id, lineId]);
  return { lineId, holiday, vessel };
}

export async function moveInfillOffLostVessel(c: pg.PoolClient, vesselId: string): Promise<void> {
  const r = await c.query(
    `SELECT l.id, l.mission_id, l.holiday_id FROM lines l
     WHERE l.vessel_id = $1 AND l.status = 'Assigned' AND l.kind = 'infill'`, [vesselId]);
  for (const l of r.rows) {
    const missionId = l.mission_id as string;
    const mid = await infillMidpoint(c, l.id as string);
    if (!mid) continue;
    const target = await nearestEligibleVessel(c, missionId, mid);
    if (!target || target.id === vesselId) continue;
    const qseqR = await c.query(
      `SELECT max(queue_seq)::int AS mx FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill'`,
      [missionId, target.id]);
    const queueSeq = (qseqR.rows[0]?.mx ?? 0) + 1;
    await c.query(`UPDATE lines SET vessel_id = $2, queue_seq = $3 WHERE id = $1`, [l.id, target.id, queueSeq]);
    await recordInfillMove(c, missionId, l.id as string, target.name);
  }
}

async function recordInfillMove(c: pg.PoolClient, missionId: string, lineId: string, vesselName: string): Promise<void> {
  const { recordEvent } = await import('./core.js');
  const label = (await c.query(`SELECT label FROM lines WHERE id = $1`, [lineId])).rows[0]!.label;
  await recordEvent(c, missionId, 'infill', 'Swathdeck', `${label} moved to ${vesselName}`);
}

export async function infillMidpoint(c: pg.PoolClient, lineId: string): Promise<Position | null> {
  const l = (await c.query(`SELECT start, "end" FROM lines WHERE id = $1`, [lineId])).rows[0];
  if (!l) return null;
  const s = l.start as Position, e = l.end as Position;
  return { easting: (s.easting + e.easting) / 2, northing: (s.northing + e.northing) / 2 };
}
