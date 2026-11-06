import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeferredResponse } from './api.js';
import { apiError, validationError, sendJson, readJsonBody, readOptionalJsonBody, newId, sha256Hex } from './http.js';
import {
  derivePlan, validatePlanInput, PlanSettings, Position, SurveyOrder, gridSpec, areaCells, CELL_SIZE,
  pointInsideOrOnEdge, isConvex, polygonArea, roundHalfUp,
} from './domain.js';
import {
  isClient, requireMission, missionProjection, missionLineRows, lineProjection, holidayProjection,
  isoT, requireOwner, loadMission,
} from './api-utils.js';
import { recordEvent, recomputeCoverage, clearAlert, raiseAlert, isMissionActive, isMissionOpen } from './core.js';
import { checkServiceOverdue } from './ingest.js';
import { createInfillLine, eligibleInfillVessels, nearestEligibleVessel, infillMidpoint } from './infill.js';
import { emailOutbox } from './mail.js';
import { getObject, objectKeyReport, putObject, storageStatus, markStorageDown } from './storage.js';
import { config } from './config.js';
import type { SessionUser } from './auth.js';

// ---------------- plan preview ----------------

const PLAN_DEFAULTS: Record<string, unknown> = {
  planned_depth_m: null, swath_ratio: 4, overlap_pct: 20,
  line_azimuth_deg: 0, planned_speed_mps: 2.0, survey_order: '1a' as SurveyOrder,
};

function planSettingsFrom(body: Record<string, unknown>): { errors: Map<string, string>; settings: PlanSettings | null; area: Position[] | null } {
  const merged = { ...PLAN_DEFAULTS, ...body };
  const errors = validatePlanInput({
    survey_area: body.survey_area,
    planned_depth_m: merged.planned_depth_m, swath_ratio: merged.swath_ratio,
    overlap_pct: merged.overlap_pct, line_azimuth_deg: merged.line_azimuth_deg,
    planned_speed_mps: merged.planned_speed_mps, survey_order: merged.survey_order,
    requireName: false, requireOrg: false, requireDate: false, requireGeofence: false,
  });
  const area = Array.isArray(body.survey_area) ? body.survey_area as Position[] : null;
  const fence = Array.isArray(body.geofence) ? body.geofence as Position[] : null;
  if (errors.size > 0) return { errors, settings: null, area };
  return {
    errors,
    settings: {
      planned_depth_m: merged.planned_depth_m as number,
      swath_ratio: merged.swath_ratio as number,
      overlap_pct: merged.overlap_pct as number,
      line_azimuth_deg: merged.line_azimuth_deg as number,
      planned_speed_mps: merged.planned_speed_mps as number,
      survey_order: merged.survey_order as SurveyOrder,
    },
    area,
  };
}

export async function handlePlanPreview(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse): Promise<void> {
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const { errors, settings, area } = planSettingsFrom(body);
  if (errors.size > 0) {
    throw apiError(422, 'validation', 'Some fields need attention', { errors: Object.fromEntries(errors) });
  }
  const plan = derivePlan(area!, settings!);
  sendJson(res, 200, {
    swath_width_m: plan.swath_width_m,
    line_spacing_m: plan.line_spacing_m,
    line_count: plan.line_count,
    crossline_count: plan.crossline_count,
    estimated_duration_s: plan.estimated_duration_s,
  });
}

// ---------------- create mission ----------------

async function idempotencyLookup(c: pg.PoolClient, key: string, endpoint: string, userId: string, body: unknown): Promise<{ status: number; response: unknown } | 'conflict' | null> {
  const bodyHash = sha256Hex(JSON.stringify(body));
  const r = await c.query(
    `SELECT status, response, body_hash FROM idempotency WHERE key = $1 AND endpoint = $2 AND user_id = $3 FOR UPDATE`,
    [key, endpoint, userId]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.body_hash !== bodyHash) return 'conflict';
  return { status: row.status, response: row.response };
}

async function idempotencyStore(c: pg.PoolClient, key: string, endpoint: string, userId: string, body: unknown, status: number, response: unknown): Promise<void> {
  const bodyHash = sha256Hex(JSON.stringify(body));
  await c.query(
    `INSERT INTO idempotency (key, endpoint, user_id, body_hash, status, response, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now()) ON CONFLICT (key, endpoint, user_id) DO NOTHING`,
    [key, endpoint, userId, bodyHash, status, JSON.stringify(response)]);
}

export async function handleCreateMission(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser): Promise<void> {
  if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
  const raw = await readRawBody(req);
  const body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  const idemKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
  if (idemKey !== null && (idemKey.length < 1 || idemKey.length > 100)) {
    throw apiError(422, 'validation', 'Some fields need attention', { errors: { idempotency_key: 'Send an idempotency key of 1 to 100 characters' } });
  }

  if (idemKey) {
    const found = await idempotencyLookup(c, idemKey, 'POST /api/missions', user.id, JSON.parse(raw.toString('utf8')));
    if (found === 'conflict') throw apiError(409, 'idempotency_conflict', 'This idempotency key was used with a different request');
    if (found) {
      sendJson(res, found.status, found.response);
      return;
    }
  }

  const orgId = body.client_org_id;
  if (typeof orgId !== 'string' || !orgId) {
    throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  }
  const org = await c.query(`SELECT id FROM client_orgs WHERE id = $1`, [orgId]);
  if (org.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');

  const errors = validatePlanInput({
    name: body.name, survey_date: body.survey_date,
    survey_area: body.survey_area, geofence: body.geofence,
    planned_depth_m: body.planned_depth_m, swath_ratio: body.swath_ratio,
    overlap_pct: body.overlap_pct, line_azimuth_deg: body.line_azimuth_deg,
    planned_speed_mps: body.planned_speed_mps, survey_order: body.survey_order,
    requireName: true, requireOrg: true, requireDate: true,
  });
  if (errors.size > 0) {
    throw apiError(422, 'validation', 'Some fields need attention', { errors: Object.fromEntries(errors) });
  }

  const settings: PlanSettings = {
    planned_depth_m: body.planned_depth_m as number,
    swath_ratio: body.swath_ratio as number,
    overlap_pct: body.overlap_pct as number,
    line_azimuth_deg: body.line_azimuth_deg as number,
    planned_speed_mps: body.planned_speed_mps as number,
    survey_order: body.survey_order as SurveyOrder,
  };
  const plan = derivePlan(body.survey_area as Position[], settings);
  const missionId = `m-${newId('').slice(2)}`;
  await c.query(
    `INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order, survey_area, geofence,
      planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg, planned_speed_mps,
      swath_width_m, line_spacing_m, line_count, crossline_count, estimated_duration_s, hold, version, owner_id, report_state, created_at)
     VALUES ($1,$2,$3,$4,'Planned',$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,1,$18,'None', now())`,
    [missionId, body.name, orgId, body.survey_date, settings.survey_order,
      JSON.stringify(body.survey_area), JSON.stringify(body.geofence),
      settings.planned_depth_m, settings.swath_ratio, settings.overlap_pct, settings.line_azimuth_deg,
      settings.planned_speed_mps, plan.swath_width_m, plan.line_spacing_m,
      plan.line_count, plan.crossline_count, plan.estimated_duration_s, user.id]
  );
  let seq = 0;
  for (const l of [...plan.lines, ...plan.crosslines]) {
    await c.query(
      `INSERT INTO lines (id, mission_id, label, kind, status, start, "end", length_m, seq)
       VALUES ($1,$2,$3,$4,'Pending',$5::jsonb,$6::jsonb,$7,$8)`,
      [newId('ln'), missionId, l.label, l.kind, JSON.stringify(l.start), JSON.stringify(l.end), l.length_m, seq++]
    );
  }
  await recomputeCoverage(c, missionId);
  await recordEvent(c, missionId, 'created', user.name, 'Mission created');
  const m = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  const response = await missionProjection(c, m, false);
  if (idemKey) await idempotencyStore(c, idemKey, 'POST /api/missions', user.id, JSON.parse(raw.toString('utf8')), 201, response);
  sendJson(res, 201, response);
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const { readRawBody } = await import('./http.js');
  return readRawBody(req, 64000);
}

// ---------------- mission transitions ----------------

export async function handleMissionTransition(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const to = body.to;
  const words = ['Launched', 'Aborted', 'Complete', 'Surveying', 'Recovering', 'Planned'];
  if (typeof to !== 'string' || !words.includes(to)) {
    throw validationError({ to: 'Choose a mission status from the published list' });
  }
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (isClient(user) && mission.client_org_id !== user.client_org_id) {
    throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  }
  const from = mission.status as string;

  if (from === to || (from === 'Complete' || from === 'Aborted') ||
    !(from === 'Planned' && to === 'Launched') && !(from === 'Recovering' && to === 'Complete') && !(isMissionActive(from) && to === 'Aborted')) {
    throw apiError(409, 'illegal_transition', `This mission cannot move from ${from} to ${to}`, { from, to });
  }

  if (to === 'Launched') {
    if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
    await requireOwner(c, user, mission);
    // 1. lines unassigned
    const un = await c.query(
      `SELECT count(*)::int AS n FROM lines WHERE mission_id = $1 AND kind IN ('planned','crossline') AND status <> 'Assigned'`,
      [missionId]);
    if (un.rows[0]!.n > 0) throw apiError(409, 'lines_unassigned', 'Assign every line and crossline before launching');
    // 2. service overdue — alphabetically first
    const vessels = await c.query(
      `SELECT DISTINCT v.name, v.hours_since_service, v.service_interval_h
       FROM lines l JOIN vessels v ON v.id = l.vessel_id
       WHERE l.mission_id = $1 AND v.hours_since_service > v.service_interval_h ORDER BY v.name`, [missionId]);
    if (vessels.rows.length > 0) {
      const v = vessels.rows[0]!;
      throw apiError(409, 'service_overdue', `${v.name} is overdue for thruster service (${Math.round(v.hours_since_service * 10) / 10} h since service, limit ${trimInterval(v.service_interval_h)} h). Log a service before assigning or launching.`);
    }
    // 3. vessels not afloat
    const ashore = await c.query(
      `SELECT DISTINCT v.name FROM lines l JOIN vessels v ON v.id = l.vessel_id
       WHERE l.mission_id = $1 AND v.afloat = false ORDER BY v.name`, [missionId]);
    if (ashore.rows.length > 0) {
      throw apiError(409, 'vessels_not_afloat', `Not afloat yet: ${ashore.rows.map((r: Record<string, unknown>) => r.name).join(', ')}`);
    }
    await c.query(`UPDATE missions SET status = 'Launched', launched_at = now(), version = version + 1 WHERE id = $1`, [missionId]);
    await recordEvent(c, missionId, 'status', user.name, `Status Planned → Launched`);
  } else if (to === 'Complete') {
    if (user.role !== 'launch_technician') throw apiError(403, 'forbidden', 'You may not do this');
    const notDelivered = await c.query(
      `SELECT count(*)::int AS n FROM lines WHERE mission_id = $1 AND status NOT IN ('Delivered','Superseded')`, [missionId]);
    if (notDelivered.rows[0]!.n > 0) throw apiError(409, 'lines_awaiting_upload', 'Upload every line file before completing');
    const afloat = await c.query(
      `SELECT DISTINCT v.name FROM lines l JOIN vessels v ON v.id = l.vessel_id
       WHERE l.mission_id = $1 AND v.afloat = true ORDER BY v.name`, [missionId]);
    if (afloat.rows.length > 0) {
      throw apiError(409, 'vessels_afloat', `Recover every vessel before completing: ${afloat.rows.map((r: Record<string, unknown>) => r.name).join(', ')}`);
    }
    // Complete + report Pending commit together
    await c.query(`UPDATE missions SET status = 'Complete', completed_at = now(), report_state = 'Pending', version = version + 1 WHERE id = $1`, [missionId]);
    await recordEvent(c, missionId, 'status', user.name, `Status Recovering → Complete`);
  } else if (to === 'Aborted') {
    if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
    await requireOwner(c, user, mission);
    await c.query(`UPDATE missions SET status = 'Aborted', hold = NULL, version = version + 1 WHERE id = $1`, [missionId]);
    await recordEvent(c, missionId, 'status', user.name, `Status ${from} → Aborted`);
    // Clear breach and link-lost alerts for this mission
    const alerts = await c.query(`SELECT id FROM alerts WHERE mission_id = $1 AND kind IN ('geofence_breach','link_lost') AND state IN ('Active','Acknowledged')`, [missionId]);
    for (const a of alerts.rows) {
      await clearAlert(c, a.id, user.name, new Date());
    }
    await c.query(`UPDATE alert_states SET breach_alert_id = NULL, lost_alert_id = NULL WHERE mission_id = $1`, [missionId]);
  }
  const m2 = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  sendJson(res, 200, await missionProjection(c, m2, isClient(user)));
  await maybeWriteReport(c, missionId);
}

function trimInterval(n: number): string {
  return String(Number(n.toFixed(1)));
}

// ---------------- report writing ----------------

export async function maybeWriteReport(c: pg.PoolClient, missionId: string): Promise<void> {
  const m = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0];
  if (!m || m.report_state !== 'Pending') return;
  const org = (await c.query(`SELECT * FROM client_orgs WHERE id = $1`, [m.client_org_id])).rows[0]!;
  const counters = (await c.query(`SELECT * FROM mission_counters WHERE mission_id = $1`, [missionId])).rows[0]!;
  const lines = await missionLineRows(c, missionId);
  const vesselsById = new Map<string, string>();
  for (const l of lines) {
    if (l.vessel_id) {
      const v = (await c.query(`SELECT name FROM vessels WHERE id = $1`, [l.vessel_id])).rows[0];
      if (v) vesselsById.set(l.vessel_id, v.name);
    }
  }
  const generatedAt = new Date();
  const generatedAtSec = new Date(Math.floor(generatedAt.getTime() / 1000) * 1000);
  const local = localTime(generatedAtSec, org.time_zone);
  const delivered = lines.filter(l =>
    (l.status === 'Delivered' && l.file_sha256) ||
    (l.status === 'Superseded' && l.file_sha256));
  const compared = counters.compared as number;
  const within = counters.within as number;
  const pct = compared === 0 ? null : roundHalfUp(within / compared * 100, 1);
  const crosslines = lines.filter(l => l.kind === 'crossline');
  const holidays = (await c.query(`SELECT label, area_m2, cell_count FROM holidays WHERE mission_id = $1 AND status IN ('Open','Queued') ORDER BY label`, [missionId])).rows;
  const vesselTotals = new Map<string, { lines: number; length: number; covered: number }>();
  for (const l of lines) {
    if (!l.vessel_id) continue;
    if (l.status !== 'Surveyed' && l.status !== 'Delivered') continue;
    const t = vesselTotals.get(l.vessel_id) ?? { lines: 0, length: 0, covered: 0 };
    t.lines += 1; t.length += l.length_m; t.covered += l.covered_m;
    vesselTotals.set(l.vessel_id, t);
  }
  const vt = [...vesselTotals.entries()].map(([vid, t]) => ({
    vessel: vesselsById.get(vid) ?? vid,
    lines: t.lines,
    length_m: roundHalfUp(t.length, 1),
    covered_m: roundHalfUp(t.covered, 1),
  })).sort((a, b) => a.vessel.localeCompare(b.vessel));

  const report = {
    mission_id: missionId,
    mission_name: m.name,
    client_name: org.name,
    completed_at: isoT(new Date(m.completed_at)),
    generated_at: isoT(generatedAtSec),
    generated_at_local: local,
    coverage_pct: counters.coverage_pct,
    open_holidays: counters.open_holidays,
    crossline_count: crosslines.length,
    crossline_agreement: { compared, within, pct, meets_order: pct === null ? null : pct >= 95.0 },
    delivered_lines: delivered.map(l => ({
      label: l.label, kind: l.kind, file_name: l.file_name,
      size_bytes: Number(l.file_size_bytes), sha256: l.file_sha256,
      key: `lines/${missionId}/${l.id}/${l.file_name}`,
    })),
    vessel_totals: vt,
    holidays: holidays.map((h: Record<string, unknown>) => ({ label: h.label, area_m2: h.area_m2, cell_count: h.cell_count })),
  };
  const bytes = canonicalJson(report);
  const sha = sha256Hex(bytes);
  // Store the bytes once; retries write the identical bytes.
  await c.query(
    `INSERT INTO mission_report (mission_id, bytes, sha256, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (mission_id) DO NOTHING`,
    [missionId, bytes, sha, generatedAtSec]);
  const stored = (await c.query(`SELECT bytes, sha256, created_at FROM mission_report WHERE mission_id = $1`, [missionId])).rows[0]!;
  const finalBytes: Buffer = Buffer.from(stored.bytes as Uint8Array);
  const finalSha = stored.sha256 as string;
  const finalAt = new Date(stored.created_at as string);
  const finalLocal = localTime(finalAt, org.time_zone);
  try {
    await putObject(objectKeyReport(missionId), finalBytes, finalSha);
  } catch {
    markStorageDown();
    return; // retried by the report timer
  }
  await c.query(`UPDATE missions SET report_state = 'Ready', report_generated_at = $2 WHERE id = $1`, [missionId, finalAt]);
  await emailOutbox.queueReportReady(c, missionId, m.name, m.client_org_id, finalSha,
    counters.coverage_pct, counters.open_holidays,
    { pct, compared }, finalAt, finalLocal);
}

function localTime(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZoneName: 'longOffset',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const h = parts.hour === '24' ? '00' : parts.hour;
  let tzName = parts.timeZoneName as string;
  let off = '+00:00';
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzName);
  if (m) off = `${m[1]}${m[2]}:${m[3]}`;
  else if (tzName === 'GMT') off = '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${h}:${parts.minute}:${parts.second}${off}`;
}

function canonicalJson(v: unknown): Buffer {
  const out = serialize(v);
  return Buffer.from(out, 'utf8');
}

function serialize(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null';
    let s = String(v);
    if (s.includes('e') || s.includes('E')) {
      s = v.toFixed(20).replace(/0+$/, '');
      if (s.endsWith('.')) s += '0';
    }
    if (s.endsWith('.0')) s = s.slice(0, -2);
    return s;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(serialize).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.entries(o).map(([k, val]) => `${JSON.stringify(k)}:${serialize(val)}`).join(',')}}`;
}

// ---------------- assignments ----------------

export async function handleAssignments(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const assignments = body.assignments;
  if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > 500) {
    throw validationError({ assignments: 'Send 1 to 500 assignment entries' });
  }
  for (const a of assignments) {
    if (typeof a !== 'object' || a === null || typeof (a as Record<string, unknown>).line_id !== 'string') {
      throw validationError({ assignments: 'Send 1 to 500 assignment entries' });
    }
  }
  // 404 for a line not in this mission or an unknown vessel
  const lineIds: string[] = [];
  for (const a of assignments as Record<string, unknown>[]) {
    const lineId = a.line_id as string;
    const line = (await c.query(`SELECT * FROM lines WHERE id = $1 AND mission_id = $2`, [lineId, missionId])).rows[0];
    if (!line) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
    lineIds.push(lineId);
    const vesselId = a.vessel_id;
    if (vesselId !== null) {
      if (typeof vesselId !== 'string') throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
      const v = (await c.query(`SELECT id FROM vessels WHERE id = $1`, [vesselId])).rows[0];
      if (!v) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
    }
  }
  const status = mission.status as string;
  if (!['Planned', 'Launched', 'Surveying'].includes(status)) {
    throw apiError(409, 'mission_not_assignable', 'This mission no longer takes assignments');
  }
  // illegal_transition for Running/Surveyed/Delivered lines — first refused in request order
  for (let i = 0; i < assignments.length; i++) {
    const a = (assignments as Record<string, unknown>[])[i]!;
    const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [a.line_id as string])).rows[0]!;
    if (!['Pending', 'Assigned'].includes(line.status)) {
      const to = a.vessel_id !== null ? 'Assigned' : 'Pending';
      throw apiError(409, 'illegal_transition', 'Only pending or assigned lines can be reassigned', { from: line.status, to });
    }
  }
  // vessel_committed: a vessel holding lines on another open mission
  const seenVessels = new Set<string>();
  for (const a of assignments as Record<string, unknown>[]) {
    const vesselId = a.vessel_id as string | null;
    if (vesselId === null) continue;
    seenVessels.add(vesselId);
    const other = await c.query(
      `SELECT DISTINCT m.id, m.name FROM missions m JOIN lines l ON l.mission_id = m.id
       WHERE l.vessel_id = $1 AND m.id <> $2 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`,
      [vesselId, missionId]);
    if (other.rows.length > 0) {
      throw apiError(409, 'vessel_committed', `${await vesselName(c, vesselId)} is already on ${other.rows[0]!.name}`);
    }
  }
  // service_overdue
  for (const vesselId of seenVessels) {
    const v = (await c.query(`SELECT * FROM vessels WHERE id = $1`, [vesselId])).rows[0]!;
    if (v.hours_since_service > v.service_interval_h) {
      throw apiError(409, 'service_overdue', overdueMessage(v.name, v.hours_since_service, v.service_interval_h));
    }
  }
  // vessels_not_afloat in Launched or Surveying missions
  if (['Launched', 'Surveying'].includes(status)) {
    const ashore: string[] = [];
    for (const vesselId of seenVessels) {
      const v = (await c.query(`SELECT * FROM vessels WHERE id = $1`, [vesselId])).rows[0]!;
      if (!v.afloat) ashore.push(v.name as string);
    }
    if (ashore.length > 0) {
      ashore.sort((a, b) => a.localeCompare(b));
      throw apiError(409, 'vessels_not_afloat', `Not afloat yet: ${ashore.join(', ')}`);
    }
  }
  for (const a of assignments as Record<string, unknown>[]) {
    const lineId = a.line_id as string;
    const vesselId = a.vessel_id as string | null;
    await c.query(
      `UPDATE lines SET vessel_id = $2, status = CASE WHEN $2::text IS NULL THEN 'Pending' ELSE 'Assigned' END WHERE id = $1`,
      [lineId, vesselId]);
  }
  await recomputeCoverage(c, missionId);
  await c.query(`UPDATE missions SET version = version + 1 WHERE id = $1`, [missionId]);
  await recordEvent(c, missionId, 'assignments', user.name, `Assignments saved (${assignments.length} lines)`);
  const lines = await missionLineRows(c, missionId);
  const nameById = new Map<string, string>();
  for (const l of lines) {
    if (l.vessel_id && !nameById.has(l.vessel_id)) nameById.set(l.vessel_id, await vesselName(c, l.vessel_id));
  }
  sendJson(res, 200, lines.map(l => lineProjection(l, l.vessel_id ? nameById.get(l.vessel_id) ?? null : null)));
}

export function overdueMessage(name: string, hours: number, interval: number): string {
  return `${name} is overdue for thruster service (${Math.round(hours * 10) / 10} h since service, limit ${trimInterval(interval)} h). Log a service before assigning or launching.`;
}

async function vesselName(c: pg.PoolClient, id: string): Promise<string> {
  return (await c.query(`SELECT name FROM vessels WHERE id = $1`, [id])).rows[0]!.name as string;
}

// ---------------- coverage ----------------

export async function handleCoverageGet(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = await requireMission(c, user, missionId);
  const area = mission.survey_area as Position[];
  const spec = gridSpec(area);
  const inArea = areaCells(area, spec.origin, spec.cols, spec.rows);
  const cells = (await c.query(`SELECT col, row, lines FROM coverage_cells WHERE mission_id = $1`, [missionId])).rows;
  const counters = (await c.query(`SELECT * FROM mission_counters WHERE mission_id = $1`, [missionId])).rows[0]
    ?? { coverage_pct: 0, open_holidays: 0, lines_remaining: 0 };
  const overlap: number[][] = [];
  const byCell = new Map<string, number>();
  for (const cell of cells) {
    byCell.set(`${cell.col},${cell.row}`, (cell.lines as string[]).length);
  }
  for (let r = 0; r < spec.rows; r++) {
    const row: number[] = [];
    for (let col = 0; col < spec.cols; col++) {
      const idx = r * spec.cols + col;
      if (!inArea.has(idx)) { row.push(-1); continue; }
      row.push(byCell.get(`${col},${r}`) ?? 0);
    }
    overlap.push(row);
  }
  sendJson(res, 200, {
    cell_size_m: CELL_SIZE, origin: spec.origin, cols: spec.cols, rows: spec.rows,
    overlap,
    counters: {
      coverage_pct: counters.coverage_pct,
      open_holidays: counters.open_holidays,
      lines_remaining: counters.lines_remaining,
    },
  });
}

// ---------------- coverage CSV ----------------

export function csvSlug(name: string, missionId: string): string {
  const deaccented = name.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const slug = deaccented.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || missionId;
}

function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvNum(n: number): string {
  return roundHalfUp(n, 1).toFixed(1);
}

export async function handleCoverageCsv(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = await requireMission(c, user, missionId);
  const lines = await missionLineRows(c, missionId);
  const nameById = new Map<string, string>();
  for (const l of lines) {
    if (l.vessel_id && !nameById.has(l.vessel_id)) {
      nameById.set(l.vessel_id, await vesselName(c, l.vessel_id));
    }
  }
  const rows: string[] = [];
  rows.push(['mission', 'line', 'kind', 'vessel', 'status', 'length_m', 'covered_m', 'coverage_pct'].map(csvField).join(','));
  for (const l of lines) {
    const pct = Math.min(100, l.length_m > 0 ? l.covered_m / l.length_m * 100 : 0);
    rows.push([
      csvField(mission.name as string),
      csvField(l.label),
      csvField(l.kind),
      csvField(l.vessel_id ? nameById.get(l.vessel_id) ?? '' : ''),
      csvField(l.status),
      csvNum(l.length_m),
      csvNum(l.covered_m),
      csvNum(pct),
    ].join(','));
  }
  const csv = rows.join('\r\n') + '\r\n';
  const buf = Buffer.from(csv, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${csvSlug(mission.name as string, missionId)}-coverage.csv"`,
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}

// ---------------- tracks ----------------

export async function handleTracks(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  await requireMission(c, user, missionId);
  const mission = (await c.query(`SELECT swath_ratio FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  const lines = await missionLineRows(c, missionId);
  const tracks: Record<string, unknown>[] = [];
  for (const l of lines) {
    const fixes = (await c.query(`SELECT * FROM fixes WHERE line_id = $1 ORDER BY t ASC`, [l.id])).rows;
    const points = fixes.map((f: Record<string, unknown>) => ({
      t: isoT(new Date(f.t as string)),
      easting: f.easting, northing: f.northing,
      depth_m: f.depth_m, swath_m: (f.depth_m as number) * (mission.swath_ratio as number),
    }));
    tracks.push({ line_id: l.id, label: l.label, vessel_id: l.vessel_id, points });
  }
  sendJson(res, 200, { tracks });
}

// ---------------- holidays and infill ----------------

export async function handleInfillQueue(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string, holidayId: string): Promise<void> {
  if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
  await requireMission(c, user, missionId);
  await readOptionalJsonBody(req, 64000);
  const holiday = (await c.query(`SELECT * FROM holidays WHERE id = $1 AND mission_id = $2 FOR UPDATE`, [holidayId, missionId])).rows[0];
  if (!holiday) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (holiday.status === 'Closed') throw apiError(409, 'holiday_closed', `${holiday.label} has already closed`);
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  if (mission.status !== 'Surveying') {
    throw apiError(409, 'mission_not_surveying', 'Infill can be queued only while the mission is surveying');
  }
  if (holiday.status === 'Queued' && holiday.infill_line_id) {
    const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [holiday.infill_line_id])).rows[0]!;
    const vName = await vesselName(c, line.vessel_id!);
    const counters = await recomputeCoverage(c, missionId);
    sendJson(res, 200, {
      line: lineProjection(line, vName),
      holiday: (await holidayProjection(c, missionId, false)).find(h => h.id === holidayId),
      counters: counters.counters,
    });
    return;
  }
  const cells = (await c.query(`SELECT col, row FROM holiday_cells WHERE holiday_id = $1`, [holidayId])).rows
    .map((r: Record<string, unknown>) => ({ col: r.col as number, row: r.row as number }));
  const nearest = await nearestEligibleVessel(c, missionId, holiday.centroid as Position);
  if (!nearest) throw apiError(409, 'no_eligible_vessel', `No eligible vessel for ${holiday.label}`);
  const created = await createInfillLine(c, missionId, {
    id: holiday.id, label: holiday.label, cells, centroid: holiday.centroid as Position,
  }, nearest);
  const newLabel = (await c.query(`SELECT label FROM lines WHERE id = $1`, [created.lineId])).rows[0]!.label;
  await recordEvent(c, missionId, 'infill', user.name, `${newLabel} queued to ${nearest.name}`);
  const counters = await recomputeCoverage(c, missionId);
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [created.lineId])).rows[0]!;
  sendJson(res, 201, {
    line: lineProjection(line, nearest.name),
    holiday: (await holidayProjection(c, missionId, false)).find(h => h.id === holidayId),
    counters: counters.counters,
  });
}

export async function handleInfillOrderGet(c: pg.PoolClient, res: DeferredResponse, user: SessionUser, missionId: string, vesselId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  await requireMission(c, user, missionId);
  const any = await c.query(`SELECT 1 FROM lines WHERE mission_id = $1 AND vessel_id = $2`, [missionId, vesselId]);
  if (any.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const q = await c.query(
    `SELECT id FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned' ORDER BY queue_seq`,
    [missionId, vesselId]);
  sendJson(res, 200, { line_ids: q.rows.map((r: Record<string, unknown>) => r.id) });
}

export async function handleInfillOrderPut(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string, vesselId: string): Promise<void> {
  if (user.role !== 'principal_surveyor') throw apiError(403, 'forbidden', 'You may not do this');
  await requireMission(c, user, missionId);
  const any = await c.query(`SELECT 1 FROM lines WHERE mission_id = $1 AND vessel_id = $2`, [missionId, vesselId]);
  if (any.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const ids = body.line_ids;
  if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) {
    throw validationError({ line_ids: 'Send each infill line id once' });
  }
  if (new Set(ids).size !== ids.length) throw validationError({ line_ids: 'Send each infill line id once' });
  for (const id of ids as string[]) {
    const l = (await c.query(
      `SELECT 1 FROM lines WHERE id = $1 AND mission_id = $2 AND vessel_id = $3 AND kind = 'infill' AND status = 'Assigned'`,
      [id, missionId, vesselId])).rows[0];
    if (!l) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  }
  const current = (await c.query(
    `SELECT id FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned' ORDER BY queue_seq`,
    [missionId, vesselId])).rows.map((r: Record<string, unknown>) => r.id as string);
  const currentSet = new Set(current);
  if ((ids as string[]).length !== currentSet.size || !(ids as string[]).every(i => currentSet.has(i))) {
    throw apiError(409, 'stale_order', 'The infill queue for this vessel has changed');
  }
  let seq = 1;
  for (const id of ids as string[]) {
    await c.query(`UPDATE lines SET queue_seq = $2 WHERE id = $1`, [id, seq++]);
  }
  sendJson(res, 200, { line_ids: ids });
}

// ---------------- mission history ----------------

const HISTORY_KINDS = ['created', 'assignments', 'status', 'line', 'file', 'alert', 'infill', 'owner', 'hold', 'geofence', 'rerun'];

export async function handleHistory(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  await requireMission(c, user, missionId);
  const url = new URL(req.url ?? '', 'http://x');
  const kindsParam = url.searchParams.get('kinds');
  const before = url.searchParams.get('before');
  let kinds: string[] | null = null;
  if (kindsParam !== null && kindsParam !== '') {
    kinds = kindsParam.split(',').map(k => k.trim()).filter(Boolean);
    for (const k of kinds) {
      if (!HISTORY_KINDS.includes(k)) throw validationError({ kinds: 'Choose kinds from the published list' });
    }
  }
  const params: unknown[] = [missionId];
  let where = `mission_id = $1`;
  if (kinds) {
    params.push(kinds);
    where += ` AND kind = ANY($2)`;
  }
  if (before) {
    params.push(Number(before));
    where += ` AND seq < $${params.length}`;
  }
  const r = await c.query(
    `SELECT seq, at, kind, actor, summary FROM mission_events WHERE ${where}
     ORDER BY at DESC, seq DESC LIMIT 50`, params);
  const events = r.rows.map((e: Record<string, unknown>) => ({
    seq: Number(e.seq), at: isoT(new Date(e.at as string)), kind: e.kind, actor: e.actor, summary: e.summary,
  }));
  let next: number | null = null;
  if (events.length === 50) next = events[events.length - 1]!.seq;
  sendJson(res, 200, { events, next });
}

// ---------------- handover, hold, resume, geofence, rerun ----------------

export async function handleHandover(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  await requireOwner(c, user, mission);
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  if (!isMissionOpen(mission.status as string)) {
    throw apiError(409, 'mission_not_open', 'This mission is not open');
  }
  const toUserId = body.to_user_id;
  const target = typeof toUserId === 'string'
    ? (await c.query(`SELECT * FROM users WHERE id = $1`, [toUserId])).rows[0]
    : undefined;
  if (!target || target.role !== 'principal_surveyor' || target.id === user.id) {
    throw validationError({ to_user_id: 'Choose another principal surveyor' });
  }
  if (body.version !== mission.version) {
    throw apiError(409, 'stale_version', `${user.name} was changed by someone else. Review the latest values and save again.`, {
      current: await missionProjection(c, mission, false),
    });
  }
  await c.query(`UPDATE missions SET owner_id = $2, version = version + 1 WHERE id = $1`, [missionId, toUserId]);
  await recordEvent(c, missionId, 'owner', user.name, `Handed to ${target.name}`);
  await emailOutbox.queueHandover(c, missionId, mission.name as string, target.email, target.name, user.name, new Date());
  const m2 = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  sendJson(res, 200, await missionProjection(c, m2, false));
}

export async function handleHold(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  await requireOwner(c, user, mission);
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  if (mission.status !== 'Surveying') throw apiError(409, 'mission_not_surveying', 'This mission is not surveying');
  if (mission.hold) throw apiError(409, 'mission_on_hold', 'This mission is already on hold');
  const running = await c.query(`SELECT 1 FROM lines WHERE mission_id = $1 AND status = 'Running'`, [missionId]);
  if (running.rows.length > 0) throw apiError(409, 'line_running', 'A line is still running on this mission');
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (reason.trim().length < 3 || reason.trim().length > 120) {
    throw validationError({ reason: 'Give a reason of 3 to 120 characters' });
  }
  await c.query(
    `UPDATE missions SET hold = $2::jsonb, version = version + 1 WHERE id = $1`,
    [missionId, JSON.stringify({ reason: reason.trim(), since: isoT(new Date()), by: user.name })]);
  await recordEvent(c, missionId, 'hold', user.name, `Held: ${reason.trim()}`);
  const m2 = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  sendJson(res, 200, await missionProjection(c, m2, false));
}

export async function handleResume(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  await requireOwner(c, user, mission);
  if (!mission.hold) throw apiError(409, 'mission_not_on_hold', 'This mission is not on hold');
  await c.query(`UPDATE missions SET hold = NULL, version = version + 1 WHERE id = $1`, [missionId]);
  await recordEvent(c, missionId, 'hold', user.name, 'Resumed');
  // Vessels already Lost raise their link-lost alerts within five seconds: do it now.
  const { runLinkTimer } = await import('./ingest.js');
  await runLinkTimer();
  const m2 = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  sendJson(res, 200, await missionProjection(c, m2, false));
}

export async function handleGeofencePut(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  await requireOwner(c, user, mission);
  if (!['Launched', 'Surveying'].includes(mission.status as string)) {
    throw apiError(409, 'mission_not_active', 'This mission is not active');
  }
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const fence = body.geofence;
  const errors = validateFence(fence, mission.survey_area as Position[]);
  if (errors.size > 0) {
    throw apiError(422, 'validation', 'Some fields need attention', { errors: Object.fromEntries(errors) });
  }
  if (body.version !== mission.version) {
    throw apiError(409, 'stale_version', `${user.name} was changed by someone else. Review the latest values and save again.`, {
      current: await missionProjection(c, mission, false),
    });
  }
  await c.query(`UPDATE missions SET geofence = $2::jsonb, version = version + 1 WHERE id = $1`, [missionId, JSON.stringify(fence)]);
  await recordEvent(c, missionId, 'geofence', user.name, 'Geofence changed');
  // Re-evaluate every vessel's open breach at once
  const vesselIds = await c.query(
    `SELECT DISTINCT vessel_id FROM lines WHERE mission_id = $1 AND vessel_id IS NOT NULL`, [missionId]);
  for (const vr of vesselIds.rows) {
    const last = await c.query(`SELECT easting, northing FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vr.vessel_id]);
    if (last.rows.length === 0) continue;
    const pos = { easting: last.rows[0]!.easting, northing: last.rows[0]!.northing };
    const inside = pointInsideOrOnEdge(pos, fence as Position[]);
    const st = (await c.query(`SELECT breach_alert_id FROM alert_states WHERE vessel_id = $1`, [vr.vessel_id])).rows[0];
    const vessel = (await c.query(`SELECT id, name FROM vessels WHERE id = $1`, [vr.vessel_id])).rows[0]!;
    if (!inside && !st?.breach_alert_id) {
      const alertId = await raiseAlert(c, 'geofence_breach', vessel, missionId, pos, new Date());
      if (!st) await c.query(`INSERT INTO alert_states (vessel_id, mission_id, breach_alert_id) VALUES ($1,$2,$3)`, [vessel.id, missionId, alertId]);
      else await c.query(`UPDATE alert_states SET breach_alert_id = $2 WHERE vessel_id = $1`, [vessel.id, alertId]);
    } else if (inside && st?.breach_alert_id) {
      await clearAlert(c, st.breach_alert_id, user.name, new Date());
      await c.query(`UPDATE alert_states SET breach_alert_id = NULL WHERE vessel_id = $1`, [vessel.id]);
    }
  }
  const m2 = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  sendJson(res, 200, await missionProjection(c, m2, false));
}

function validateFence(fence: unknown, area: Position[]): Map<string, string> {
  const errors = new Map<string, string>();
  const fencePts = Array.isArray(fence) ? fence as Position[] : null;
  if (!fencePts || fencePts.length < 3 || fencePts.length > 40) {
    errors.set('geofence', 'Enter 3 to 40 geofence corners as easting, northing');
    return errors;
  }
  const badPt = fencePts.some(p => typeof p !== 'object' || p === null ||
    typeof (p as Position).easting !== 'number' || typeof (p as Position).northing !== 'number');
  if (badPt) {
    errors.set('geofence', 'Enter 3 to 40 geofence corners as easting, northing');
    return errors;
  }
  if (!isConvex(fencePts)) errors.set('geofence', 'The geofence must be a convex shape');
  else if (!area.every(p => pointInsideOrOnEdge(p, fencePts))) errors.set('geofence', 'The geofence must enclose the survey area');
  return errors;
}

export async function handleRerun(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string, lineId: string): Promise<void> {
  const mission = (await c.query(`SELECT * FROM missions WHERE id = $1 FOR UPDATE`, [missionId])).rows[0];
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  await requireOwner(c, user, mission);
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1 AND mission_id = $2`, [lineId, missionId])).rows[0];
  if (!line) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (line.kind === 'infill') throw apiError(409, 'illegal_transition', 'Infill lines cannot be re-run');
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (reason.trim().length < 3 || reason.trim().length > 200) {
    throw validationError({ reason: 'Give a reason of 3 to 200 characters' });
  }
  if (!['Launched', 'Surveying'].includes(mission.status as string)) {
    throw apiError(409, 'mission_not_active', 'This mission is not active');
  }
  if (!['Surveyed', 'Delivered'].includes(line.status as string)) {
    throw apiError(409, 'illegal_transition', `Line ${line.label} cannot be re-run from ${line.status}`);
  }
  const openRerun = await c.query(
    `SELECT 1 FROM lines WHERE rerun_of = $1 AND status <> 'Delivered'`, [lineId]);
  if (openRerun.rows.length > 0) throw apiError(409, 'rerun_open', 'This line already has a re-run in progress');
  const n = (await c.query(`SELECT count(*)::int AS n FROM lines WHERE rerun_of = $1`, [lineId])).rows[0]!.n + 1;
  const newLabel = `${line.label}R${n}`;
  const newLineId = newId('ln');
  const seqR = await c.query(`SELECT max(seq)::int AS mx FROM lines WHERE mission_id = $1`, [missionId]);
  const seq = (seqR.rows[0]?.mx ?? -1) + 1;
  await c.query(
    `INSERT INTO lines (id, mission_id, label, kind, status, rerun_of, start, "end", length_m, seq)
     VALUES ($1,$2,$3,$4,'Pending',$5,$6::jsonb,$7::jsonb,$8,$9)`,
    [newLineId, missionId, newLabel, line.kind, lineId, JSON.stringify(line.start), JSON.stringify(line.end), line.length_m, seq]
  );
  await c.query(`UPDATE missions SET version = version + 1 WHERE id = $1`, [missionId]);
  await recordEvent(c, missionId, 'rerun', user.name, `${newLabel} added: ${reason.trim()}`);
  await recomputeCoverage(c, missionId);
  const l2 = (await c.query(`SELECT * FROM lines WHERE id = $1`, [newLineId])).rows[0]!;
  sendJson(res, 201, { line: lineProjection(l2, null) });
}

// ---------------- flags ----------------

export async function handleFlagCreate(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string, lineId: string): Promise<void> {
  if (user.role !== 'client_reviewer') throw apiError(403, 'forbidden', 'You may not do this');
  const mission = await loadMission(c, user, missionId);
  if (!mission) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1 AND mission_id = $2`, [lineId, missionId])).rows[0];
  if (!line) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (line.status !== 'Delivered') throw apiError(409, 'line_not_delivered', 'Only a delivered line can be flagged');
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const comment = typeof body.comment === 'string' ? body.comment : '';
  if (comment.trim().length < 1 || comment.trim().length > 500) {
    throw validationError({ comment: 'Write a comment of 1 to 500 characters' });
  }
  const flagId = newId('fl');
  await c.query(
    `INSERT INTO flags (id, mission_id, line_id, by, comment, at, state) VALUES ($1,$2,$3,$4,$5, now(), 'Open')`,
    [flagId, missionId, lineId, user.id, comment.trim()]);
  const org = (await c.query(`SELECT name FROM client_orgs WHERE id = $1`, [mission.client_org_id])).rows[0]!;
  await emailOutbox.queueFlagEmail(c, flagId, missionId, mission.name as string, line.label, comment.trim(), org.name);
  const f = (await c.query(`SELECT * FROM flags WHERE id = $1`, [flagId])).rows[0]!;
  sendJson(res, 201, {
    id: f.id, line_label: line.label, comment: f.comment, by: user.name,
    at: isoT(new Date(f.at as string)), state: 'Open', reply: null,
  });
}
