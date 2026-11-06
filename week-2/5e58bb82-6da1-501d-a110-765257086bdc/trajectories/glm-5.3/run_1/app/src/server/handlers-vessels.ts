import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeferredResponse } from './api.js';
import { apiError, validationError, sendJson, readJsonBody, readOptionalJsonBody, newId, sha256Hex } from './http.js';
import { isClient, isoT, vesselProjection } from './api-utils.js';
import { recomputeCoverage, recordEvent } from './core.js';
import { overdueMessage } from './handlers-missions.js';
import { checkServiceOverdue } from './ingest.js';
import type { SessionUser } from './auth.js';

const openMission = `SELECT DISTINCT m.id FROM missions m JOIN lines l ON l.mission_id = m.id
  WHERE l.vessel_id = $1 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`;

export async function handleVesselsList(c: pg.PoolClient, res: DeferredResponse, user: SessionUser): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const r = await c.query(`SELECT id FROM vessels ORDER BY seed_order`);
  const out = [];
  for (const row of r.rows) out.push(await vesselProjection(c, row.id as string, false));
  sendJson(res, 200, out);
}

export async function handleVesselGet(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  const exists = await c.query(`SELECT id FROM vessels WHERE id = $1`, [vesselId]);
  if (exists.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  sendJson(res, 200, await vesselProjection(c, vesselId, false));
}

export async function handleVesselPatch(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const r = await c.query(`SELECT * FROM vessels WHERE id = $1 FOR UPDATE`, [vesselId]);
  if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
  const v = r.rows[0]!;
  const interval = body.service_interval_h;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 50 || interval > 1000
    || Math.round(interval * 10) !== interval * 10) {
    throw validationError({ service_interval_h: 'Service interval must be between 50 and 1000 h' });
  }
  if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
    throw validationError({ version: 'Send the vessel version you last read' });
  }
  if (body.version !== v.version) {
    throw apiError(409, 'stale_version', `${v.name} was changed by someone else. Review the latest values and save again.`, {
      current: await vesselProjection(c, vesselId, false),
    });
  }
  await c.query(`UPDATE vessels SET service_interval_h = $2, version = version + 1 WHERE id = $1`, [vesselId, interval]);
  await checkServiceOverdue(c, { id: v.id, name: v.name, hours_since_service: v.hours_since_service, service_interval_h: interval }, null);
  const missionR = await c.query(openMission, [vesselId]);
  if (missionR.rows[0]) await recomputeCoverage(c, missionR.rows[0]!.id);
  sendJson(res, 200, await vesselProjection(c, vesselId, false));
}

export async function handleAfloat(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  await readOptionalJsonBody(req, 64000);
  const r = await c.query(`SELECT * FROM vessels WHERE id = $1 FOR UPDATE`, [vesselId]);
  if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (user.role !== 'launch_technician') throw apiError(403, 'forbidden', 'You may not do this');
  const v = r.rows[0]!;
  if (v.hours_since_service > v.service_interval_h) {
    throw apiError(409, 'service_overdue', overdueMessage(v.name, v.hours_since_service, v.service_interval_h));
  }
  if (!v.afloat) {
    await c.query(`UPDATE vessels SET afloat = true, version = version + 1 WHERE id = $1`, [vesselId]);
  }
  sendJson(res, 200, await vesselProjection(c, vesselId, false));
}

export async function handleRecovered(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  await readOptionalJsonBody(req, 64000);
  const r = await c.query(`SELECT * FROM vessels WHERE id = $1 FOR UPDATE`, [vesselId]);
  if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (user.role !== 'launch_technician') throw apiError(403, 'forbidden', 'You may not do this');
  const v = r.rows[0]!;
  const running = await c.query(`SELECT 1 FROM lines WHERE vessel_id = $1 AND status = 'Running'`, [vesselId]);
  if (running.rows.length > 0) throw apiError(409, 'line_running', `${v.name} is still running a line`);
  if (v.afloat) {
    await c.query(`UPDATE vessels SET afloat = false, version = version + 1 WHERE id = $1`, [vesselId]);
  }
  sendJson(res, 200, await vesselProjection(c, vesselId, false));
}

export async function handleServiceCreate(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const raw = await readJsonBody(req, 64000) as Record<string, unknown>;
  const note = typeof raw.note === 'string' ? raw.note : '';
  const idemKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
  const r = await c.query(`SELECT * FROM vessels WHERE id = $1 FOR UPDATE`, [vesselId]);
  if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const v = r.rows[0]!;
  if (idemKey) {
    const found = await idempotencyLookup(c, idemKey, 'POST services', user.id, raw);
    if (found === 'conflict') throw apiError(409, 'idempotency_conflict', 'This idempotency key was used with a different request');
    if (found) { sendJson(res, found.status, found.response); return; }
  }
  if (v.afloat) {
    throw apiError(409, 'vessel_afloat', `Recover ${v.name} before logging a service`);
  }
  if (note.trim().length < 1 || note.length > 500) {
    throw validationError({ note: 'Enter a service note of up to 500 characters' });
  }
  const serviceId = newId('svc');
  const hoursAtService = Math.round(v.hours_since_service * 1000) / 1000;
  await c.query(
    `INSERT INTO services (id, vessel_id, logged_at, logged_by, hours_at_service, note) VALUES ($1,$2, now(), $3, $4, $5)`,
    [serviceId, vesselId, user.id, hoursAtService, note]);
  await c.query(`UPDATE vessels SET hours_since_service = 0, version = version + 1 WHERE id = $1`, [vesselId]);
  // A no-longer-overdue vessel clears its service alert
  await checkServiceOverdue(c, { id: v.id, name: v.name, hours_since_service: 0, service_interval_h: v.service_interval_h }, null);
  const response = {
    id: serviceId, vessel_id: vesselId, logged_at: isoT(new Date()),
    logged_by: user.id, hours_at_service: hoursAtService, note,
  };
  if (idemKey) {
    await c.query(
      `INSERT INTO idempotency (key, endpoint, user_id, body_hash, status, response, created_at)
       VALUES ($1,$2,$3,$4,201,$5::jsonb, now()) ON CONFLICT (key, endpoint, user_id) DO NOTHING`,
      [idemKey, 'POST services', user.id, sha256Hex(JSON.stringify(raw)), JSON.stringify(response)]);
  }
  sendJson(res, 201, response);
}

async function idempotencyLookup(c: pg.PoolClient, key: string, endpoint: string, userId: string, body: unknown): Promise<{ status: number; response: unknown } | 'conflict' | null> {
  const bodyHash = sha256Hex(JSON.stringify(body));
  const r = await c.query(
    `SELECT status, response, body_hash FROM idempotency WHERE key = $1 AND endpoint = $2 AND user_id = $3`,
    [key, endpoint, userId]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.body_hash !== bodyHash) return 'conflict';
  return { status: row.status, response: row.response };
}

export async function handleServiceList(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const v = await c.query(`SELECT id FROM vessels WHERE id = $1`, [vesselId]);
  if (v.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const r = await c.query(`SELECT s.*, u.name AS by_name FROM services s JOIN users u ON u.id = s.logged_by WHERE s.vessel_id = $1 ORDER BY s.logged_at DESC`, [vesselId]);
  sendJson(res, 200, r.rows.map((s: Record<string, unknown>) => ({
    id: s.id, vessel_id: s.vessel_id, logged_at: isoT(new Date(s.logged_at as string)),
    logged_by: s.by_name, hours_at_service: s.hours_at_service, note: s.note,
  })));
}

export async function handleVesselFixes(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, vesselId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const v = await c.query(`SELECT id FROM vessels WHERE id = $1`, [vesselId]);
  if (v.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const url = new URL(req.url ?? '', 'http://x');
  const windowS = url.searchParams.get('window_s');
  let rows: Record<string, unknown>[];
  if (windowS === null) {
    rows = (await c.query(`SELECT * FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 20`, [vesselId])).rows;
  } else {
    if (windowS !== '600') throw validationError({ window_s: 'Send window_s as 600' });
    rows = (await c.query(
      `SELECT * FROM fixes WHERE vessel_id = $1 AND t >= (SELECT max(t) - interval '600 seconds' FROM fixes WHERE vessel_id = $1) ORDER BY t DESC`,
      [vesselId])).rows;
  }
  sendJson(res, 200, rows.map((f: Record<string, unknown>) => ({
    t: isoT(new Date(f.t as string)), received_at: isoT(new Date(f.received_at as string)),
    position: { easting: f.easting, northing: f.northing },
    heading_deg: f.heading_deg, speed_mps: f.speed_mps,
    battery_pct: f.battery_pct, depth_m: f.depth_m,
  })));
}
