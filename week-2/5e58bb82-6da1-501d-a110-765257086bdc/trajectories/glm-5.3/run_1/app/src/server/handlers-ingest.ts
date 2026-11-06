import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeferredResponse } from './api.js';
import { apiError, sendJson, readJsonBody, readOptionalJsonBody } from './http.js';
import { validateFix, applyFix, IngestContext, FixInput } from './ingest.js';
import { recordEvent, recomputeCoverage, isMissionActive } from './core.js';
import { isoT } from './api-utils.js';

async function vesselByIngestKey(c: pg.PoolClient, req: IncomingMessage): Promise<{ id: string; name: string; afloat: boolean; hours_since_service: number; service_interval_h: number }> {
  const key = req.headers['x-ingest-key'];
  if (typeof key !== 'string' || !key) throw apiError(401, 'invalid_ingest_key', 'Send a valid ingest key');
  const r = await c.query(`SELECT * FROM vessels WHERE ingest_key = $1`, [key]);
  if (r.rows.length === 0) throw apiError(401, 'invalid_ingest_key', 'Send a valid ingest key');
  const v = r.rows[0]!;
  return {
    id: v.id, name: v.name, afloat: v.afloat,
    hours_since_service: v.hours_since_service, service_interval_h: v.service_interval_h,
  };
}

async function ingestContext(c: pg.PoolClient, vessel: { id: string }): Promise<IngestContext> {
  const r = await c.query(
    `SELECT DISTINCT m.id FROM missions m JOIN lines l ON l.mission_id = m.id
     WHERE l.vessel_id = $1 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`, [vessel.id]);
  return { c, vessel: vessel as IngestContext['vessel'], missionId: r.rows[0]?.id ?? null };
}


function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export async function handleFixes(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse): Promise<void> {
  const vessel = await vesselByIngestKey(c, req);
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;

  if (Array.isArray((body as { fixes?: unknown }).fixes)) {
    // batch
    const fixes = (body as { fixes: unknown[] }).fixes;
    if (fixes.length < 1 || fixes.length > 100) {
      throw apiError(422, 'validation', 'Some fields need attention', { errors: { fixes: 'Send 1 to 100 fixes' } });
    }
    // validate whole batch first
    const errors: Record<string, string> = {};
    const times: (Date | null)[] = [];
    fixes.forEach((f, i) => {
      const prefix = `fixes.${i}.`;
      const fi = f as unknown as FixInput;
      const v = validateFix(fi, prefix);
      Object.assign(errors, v.errors);
      times.push(v.t);
      // duplicate t within batch
      if (v.t) {
        for (let j = 0; j < i; j++) {
          if (times[j] && times[j]!.getTime() === v.t.getTime()) {
            errors[`fixes.${i}.t`] = 'Each fix in a batch needs its own time';
          }
        }
      }
    });
    if (Object.keys(errors).length > 0) {
      throw apiError(422, 'validation', 'Some fields need attention', { errors });
    }
    // stale check: any fix earlier than the vessel's latest stored t (before batch)
    const latest = await c.query(`SELECT t FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vessel.id]);
    const latestT = latest.rows.length ? new Date(latest.rows[0]!.t) : null;
    if (latestT) {
      for (let i = 0; i < fixes.length; i++) {
        if (times[i]!.getTime() < latestT.getTime()) {
          throw apiError(409, 'stale_fix', 'A fix in this batch is older than the vessel\'s latest fix', { index: i });
        }
      }
    }
    // apply in ascending t
    const order = fixes.map((_, i) => i).sort((a, b) => times[a]!.getTime() - times[b]!.getTime());
    const ctx = await ingestContext(c, vessel);
    let accepted = 0, replayed = 0;
    let coverageMission: string | null = null;
    for (const i of order) {
      const f = fixes[i] as unknown as FixInput;
      const exists = await c.query(`SELECT 1 FROM fixes WHERE vessel_id = $1 AND t = $2`, [vessel.id, times[i]]);
      if (exists.rows.length > 0) { replayed++; continue; }
      await c.query('SAVEPOINT fix_insert');
      try {
        const applied = await applyFix(ctx, {
          t: times[i]!, received_at: new Date(), easting: f.easting as number, northing: f.northing as number,
          heading_deg: f.heading_deg as number, speed_mps: f.speed_mps as number,
          battery_pct: f.battery_pct as number, depth_m: f.depth_m as number, line_id: null,
        });
        coverageMission = applied.coverageMission ?? coverageMission;
        await c.query('RELEASE SAVEPOINT fix_insert');
        accepted++;
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT fix_insert');
        if (isUniqueViolation(e)) { replayed++; continue; }
        throw e;
      }
    }
    // Coverage is recomputed once per batch, after all its fixes are applied.
    if (accepted > 0 && coverageMission) {
      await recomputeCoverage(c, coverageMission);
    }
    const lastR = await c.query(`SELECT t FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vessel.id]);
    const lastT = lastR.rows.length ? isoT(new Date(lastR.rows[0]!.t)) : null;
    const receivedR = await c.query(`SELECT received_at FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vessel.id]);
    const age = receivedR.rows.length ? (Date.now() - new Date(receivedR.rows[0]!.received_at).getTime()) / 1000 : null;
    const link = age === null ? 'Lost' : (age < 10 ? 'Live' : age <= 60 ? 'Stale' : 'Lost');
    sendJson(res, accepted >= 1 ? 201 : 200, {
      vessel_id: vessel.id, accepted, replayed, link_state: link, last_t: lastT,
    });
    return;
  }

  // single fix
  const v = validateFix(body as unknown as FixInput, '');
  if (Object.keys(v.errors).length > 0) {
    throw apiError(422, 'validation', 'Some fields need attention', { errors: v.errors });
  }
  const exists = await c.query(`SELECT 1 FROM fixes WHERE vessel_id = $1 AND t = $2`, [vessel.id, v.t]);
  if (exists.rows.length > 0) {
    sendJson(res, 200, { vessel_id: vessel.id, received_at: isoT(new Date()), link_state: 'Live', duplicate: true });
    return;
  }
  const latest = await c.query(`SELECT t FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vessel.id]);
  if (latest.rows.length > 0 && v.t!.getTime() < new Date(latest.rows[0]!.t).getTime()) {
    throw apiError(409, 'out_of_order', 'This fix is older than the vessel\'s latest fix');
  }
  const ctx = await ingestContext(c, vessel);
  await c.query('SAVEPOINT fix_insert');
  try {
    const applied = await applyFix(ctx, {
      t: v.t!, received_at: new Date(), easting: (body as unknown as FixInput).easting as number,
      northing: (body as unknown as FixInput).northing as number, heading_deg: (body as unknown as FixInput).heading_deg as number,
      speed_mps: (body as unknown as FixInput).speed_mps as number, battery_pct: (body as unknown as FixInput).battery_pct as number,
      depth_m: (body as unknown as FixInput).depth_m as number, line_id: null,
    });
    if (applied.coverageMission) await recomputeCoverage(c, applied.coverageMission);
    await c.query('RELEASE SAVEPOINT fix_insert');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT fix_insert');
    if (isUniqueViolation(e)) {
      // An identical fix from a concurrent request won the race: this one is a replay.
      sendJson(res, 200, { vessel_id: vessel.id, received_at: isoT(new Date()), link_state: 'Live', duplicate: true });
      return;
    }
    throw e;
  }
  sendJson(res, 201, { vessel_id: vessel.id, received_at: isoT(new Date()), link_state: 'Live', duplicate: false });
}

export async function handleLineStartEnd(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, lineId: string, phase: 'start' | 'end'): Promise<void> {
  const vessel = await vesselByIngestKey(c, req);
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [lineId])).rows[0];
  if (!line || line.vessel_id !== vessel.id) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [line.mission_id])).rows[0]!;

  if (phase === 'start') {
    if (!isMissionActive(mission.status)) {
      throw apiError(409, 'mission_not_active', 'This mission is not running');
    }
    if (mission.hold) throw apiError(409, 'mission_on_hold', 'This mission is on hold');
    const v = (await c.query(`SELECT * FROM vessels WHERE id = $1`, [vessel.id])).rows[0]!;
    if (v.hours_since_service > v.service_interval_h) {
      throw apiError(409, 'service_overdue', `${v.name} is overdue for thruster service (${Math.round(v.hours_since_service * 10) / 10} h since service, limit ${trimInterval(v.service_interval_h)} h). Log a service before assigning or launching.`);
    }
    const busy = await c.query(`SELECT id FROM lines WHERE vessel_id = $1 AND status = 'Running' AND id <> $2`, [vessel.id, lineId]);
    if (busy.rows.length > 0) throw apiError(409, 'vessel_busy', 'This vessel already has a running line');
    if (line.status !== 'Assigned') {
      throw apiError(409, 'illegal_transition', `Line ${line.label} cannot move from ${line.status} to Running`, { from: line.status, to: 'Running' });
    }
    await c.query(`UPDATE lines SET status = 'Running' WHERE id = $1`, [lineId]);
    await recordEvent(c, line.mission_id, 'line', 'Swathdeck', `${line.label} Assigned → Running`);
    if (mission.status === 'Launched') {
      await c.query(`UPDATE missions SET status = 'Surveying' WHERE id = $1`, [mission.id]);
      await c.query(`UPDATE missions SET version = version + 1 WHERE id = $1`, [mission.id]);
      await recordEvent(c, mission.id, 'status', 'Swathdeck', `Status Launched → Surveying`);
    }
    const l2 = (await c.query(`SELECT * FROM lines WHERE id = $1`, [lineId])).rows[0]!;
    sendJson(res, 200, { line: lineBody(l2) });
    return;
  }

  // end
  if (line.status !== 'Running') {
    throw apiError(409, 'illegal_transition', `Line ${line.label} cannot move from ${line.status} to Surveyed`, { from: line.status, to: 'Surveyed' });
  }
  await c.query(`UPDATE lines SET status = 'Surveyed' WHERE id = $1`, [lineId]);
  await recordEvent(c, line.mission_id, 'line', 'Swathdeck', `${line.label} Running → Surveyed`);
  await recomputeCoverage(c, line.mission_id);
  // Automatic: Surveying → Recovering when every line is Surveyed/Delivered/Superseded
  const remaining = await c.query(
    `SELECT count(*)::int AS n FROM lines WHERE mission_id = $1 AND status NOT IN ('Surveyed','Delivered','Superseded')`,
    [line.mission_id]);
  if (mission.status === 'Surveying' && remaining.rows[0]!.n === 0) {
    await c.query(`UPDATE missions SET status = 'Recovering' WHERE id = $1`, [mission.id]);
    await c.query(`UPDATE missions SET version = version + 1 WHERE id = $1`, [mission.id]);
    await recordEvent(c, mission.id, 'status', 'Swathdeck', `Status Surveying → Recovering`);
  }
  const l2 = (await c.query(`SELECT * FROM lines WHERE id = $1`, [lineId])).rows[0]!;
  sendJson(res, 200, { line: lineBody(l2) });
}

export function trimInterval(n: number): string {
  return String(Number(n.toFixed(1)));
}

function lineBody(l: Record<string, unknown>): Record<string, unknown> {
  return {
    id: l.id, mission_id: l.mission_id, label: l.label, kind: l.kind,
    status: l.status, rerun_of: l.rerun_of, vessel_id: l.vessel_id, vessel_name: null,
    start: l.start, end: l.end, length_m: l.length_m, covered_m: l.covered_m,
    holiday_id: l.holiday_id,
    file: ['Surveyed', 'Delivered', 'Superseded'].includes(l.status as string)
      ? (l.file_sha256 ? { state: 'Stored', name: l.file_name, size_bytes: Number(l.file_size_bytes), sha256: l.file_sha256, stored_at: isoT(new Date(l.file_stored_at as string)) }
        : { state: 'Awaiting upload', name: null, size_bytes: null, sha256: null, stored_at: null })
      : null,
  };
}
