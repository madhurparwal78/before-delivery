import type pg from 'pg';
import { apiError } from './http.js';
import type { User, SessionUser } from './auth.js';

export function isClient(u: User): boolean { return u.role === 'client_reviewer'; }

export function isoT(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function overlapsForbidden(key: string): boolean {
  return /thruster|service|ingest|acknowledged/i.test(key);
}

export function projectForClient(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (overlapsForbidden(k)) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = projectForClient(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function isoDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function roundHalfUp(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * Math.abs(n) * f) / f;
}

export async function loadMission(c: pg.PoolClient, user: User, missionId: string): Promise<Record<string, unknown> | null> {
  const r = await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId]);
  if (r.rows.length === 0) return null;
  const m = r.rows[0]!;
  if (isClient(user) && m.client_org_id !== user.client_org_id) return null;
  return m;
}

export async function requireMission(c: pg.PoolClient, user: User, missionId: string): Promise<Record<string, unknown>> {
  const m = await loadMission(c, user, missionId);
  if (!m) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  return m;
}

export async function requireStaffMission(c: pg.PoolClient, user: User, missionId: string): Promise<Record<string, unknown>> {
  if (isClient(user)) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  return requireMission(c, user, missionId);
}

export async function requireOwner(c: pg.PoolClient, user: SessionUser, mission: Record<string, unknown>): Promise<void> {
  if (user.role !== 'principal_surveyor') {
    throw apiError(403, 'forbidden', 'You may not do this');
  }
  if (mission.owner_id !== user.id) {
    const owner = (await c.query(`SELECT name FROM users WHERE id = $1`, [mission.owner_id])).rows[0];
    throw apiError(403, 'not_mission_owner', `Only ${owner?.name ?? 'the owner'} can do this for ${mission.name}.`);
  }
}

export async function missionProjection(c: pg.PoolClient, row: Record<string, unknown>, client: boolean): Promise<Record<string, unknown>> {
  const missionId = row.id as string;
  const counters = (await c.query(`SELECT * FROM mission_counters WHERE mission_id = $1`, [missionId])).rows[0]
    ?? { coverage_pct: 0, open_holidays: 0, lines_remaining: 0, compared: 0, within: 0 };
  const vesselIds = (await c.query(
    `SELECT DISTINCT vessel_id FROM lines WHERE mission_id = $1 AND vessel_id IS NOT NULL`, [missionId])).rows;
  const active = ['Launched', 'Surveying', 'Recovering'].includes(row.status as string);
  const vesselsOut: Record<string, unknown>[] = [];
  for (const vr of vesselIds) {
    const v = (await c.query(`SELECT id, name FROM vessels WHERE id = $1`, [vr.vessel_id])).rows[0]!;
    let link: string | null;
    if (client && !active) link = null;
    else {
      const last = await c.query(`SELECT received_at FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [v.id]);
      const age = last.rows.length ? (Date.now() - new Date(last.rows[0]!.received_at).getTime()) / 1000 : null;
      link = age === null ? 'Lost' : (age < 10 ? 'Live' : age <= 60 ? 'Stale' : 'Lost');
    }
    vesselsOut.push({ id: v.id, name: v.name, link_state: link });
  }
  vesselsOut.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const owner = (await c.query(`SELECT name FROM users WHERE id = $1`, [row.owner_id])).rows[0];
  const org = (await c.query(`SELECT name FROM client_orgs WHERE id = $1`, [row.client_org_id])).rows[0];
  const compared = counters.compared as number;
  const within = counters.within as number;
  const agreement = compared === 0
    ? { compared: 0, within: 0, pct: null, meets_order: null }
    : (() => {
      const pct = roundHalfUp(within / compared * 100, 1);
      return { compared, within, pct, meets_order: pct >= 95.0 };
    })();
  const out: Record<string, unknown> = {
    id: missionId, name: row.name, client_org_id: row.client_org_id,
    client_name: org?.name ?? null,
    survey_date: isoDate(new Date(row.survey_date as string)),
    status: row.status,
    survey_order: row.survey_order,
    survey_area: row.survey_area, geofence: row.geofence,
    planned_depth_m: row.planned_depth_m, swath_ratio: row.swath_ratio,
    overlap_pct: row.overlap_pct, line_azimuth_deg: row.line_azimuth_deg,
    planned_speed_mps: row.planned_speed_mps,
    swath_width_m: row.swath_width_m, line_spacing_m: row.line_spacing_m,
    line_count: row.line_count, crossline_count: row.crossline_count,
    estimated_duration_s: row.estimated_duration_s,
    counters: {
      coverage_pct: counters.coverage_pct,
      open_holidays: counters.open_holidays,
      lines_remaining: counters.lines_remaining,
    },
    crossline_agreement: agreement,
    vessels: vesselsOut,
    report: { state: row.report_state },
    owner_id: row.owner_id, owner_name: owner?.name ?? null,
    version: row.version,
    hold: row.hold,
    created_at: isoT(new Date(row.created_at as string)),
    launched_at: isoT(row.launched_at ? new Date(row.launched_at as string) : null),
    completed_at: isoT(row.completed_at ? new Date(row.completed_at as string) : null),
  };
  return client ? projectForClient(out) : out;
}

export interface LineRow {
  id: string; mission_id: string; label: string; kind: string; status: string;
  rerun_of: string | null; vessel_id: string | null; start: unknown; end: unknown;
  length_m: number; covered_m: number; holiday_id: string | null;
  file_name: string | null; file_size_bytes: string | null; file_sha256: string | null; file_stored_at: Date | null;
  seq: number;
}

export async function missionLineRows(c: pg.PoolClient, missionId: string): Promise<LineRow[]> {
  const r = await c.query(`SELECT * FROM lines WHERE mission_id = $1`, [missionId]);
  const rows = r.rows as unknown as Record<string, unknown>[];
  const seqById = new Map(rows.map(l => [l.id as string, l.seq as number]));
  const ordered = [...rows].sort((a, b) => {
    const baseA = a.rerun_of ? (seqById.get(a.rerun_of as string) ?? a.seq as number) : a.seq as number;
    const baseB = b.rerun_of ? (seqById.get(b.rerun_of as string) ?? b.seq as number) : b.seq as number;
    if (baseA !== baseB) return baseA - baseB;
    return (a.seq as number) - (b.seq as number);
  });
  return ordered.map(l => l as unknown as LineRow);
}

export function lineProjection(row: LineRow, vesselName: string | null): Record<string, unknown> {
  let file: Record<string, unknown> | null = null;
  if (row.status === 'Surveyed' || row.status === 'Delivered' || row.status === 'Superseded') {
    file = row.file_sha256
      ? {
        state: 'Stored', name: row.file_name, size_bytes: Number(row.file_size_bytes),
        sha256: row.file_sha256, stored_at: isoT(row.file_stored_at),
      }
      : { state: 'Awaiting upload', name: null, size_bytes: null, sha256: null, stored_at: null };
  }
  return {
    id: row.id, mission_id: row.mission_id, label: row.label, kind: row.kind,
    status: row.status, rerun_of: row.rerun_of,
    vessel_id: row.vessel_id, vessel_name: vesselName,
    start: row.start, end: row.end,
    length_m: row.length_m, covered_m: row.covered_m,
    holiday_id: row.holiday_id, file,
  };
}

export async function vesselProjection(c: pg.PoolClient, id: string, client: boolean): Promise<Record<string, unknown> | null> {
  const { loadVessel } = await import('./core.js');
  const r = await loadVessel(c, id);
  if (!r) return null;
  const v = r.v;
  const missionR = await c.query(
    `SELECT DISTINCT m.id FROM missions m JOIN lines l ON l.mission_id = m.id
     WHERE l.vessel_id = $1 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`, [id]);
  const runningR = await c.query(`SELECT id FROM lines WHERE vessel_id = $1 AND status = 'Running' LIMIT 1`, [id]);
  const overdue = v.hours_since_service > v.service_interval_h;
  const out: Record<string, unknown> = {
    id: v.id, name: v.name, version: v.version, link_state: v.link_state,
    last_fix_received_at: isoT(v.last_fix ? v.last_fix.received_at : null),
    last_fix: v.last_fix ? {
      t: isoT(v.last_fix.t), position: { easting: v.last_fix.easting, northing: v.last_fix.northing },
      heading_deg: v.last_fix.heading_deg, speed_mps: v.last_fix.speed_mps,
      battery_pct: v.last_fix.battery_pct, depth_m: v.last_fix.depth_m,
    } : null,
    afloat: v.afloat,
    mission_id: missionR.rows[0]?.id ?? null,
    running_line_id: runningR.rows[0]?.id ?? null,
    thruster_hours_total: Math.round(v.thruster_hours_total * 1000) / 1000,
    hours_since_service: Math.round(v.hours_since_service * 1000) / 1000,
    service_interval_h: v.service_interval_h,
    service_overdue: overdue,
  };
  return client ? projectForClient(out) : out;
}

export async function alertProjection(c: pg.PoolClient, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const h = await c.query(`SELECT state, at, by FROM alert_history WHERE alert_id = $1 ORDER BY at ASC, id ASC`, [row.id]);
  return {
    id: row.id, kind: row.kind, state: row.state, heading: row.heading,
    vessel_id: row.vessel_id, vessel_name: row.vessel_name,
    mission_id: row.mission_id,
    raised_at: isoT(new Date(row.raised_at as string)),
    rectified_at: isoT(row.rectified_at ? new Date(row.rectified_at as string) : null),
    position: row.position,
    acknowledged_at: isoT(row.acknowledged_at ? new Date(row.acknowledged_at as string) : null),
    acknowledged_by: row.acknowledged_by_name,
    email: row.email, escalation: row.escalation,
    history: h.rows.map((r: Record<string, unknown>) => ({ state: r.state, at: isoT(new Date(r.at as string)), by: r.by })),
  };
}

export async function holidayProjection(c: pg.PoolClient, missionId: string, client: boolean): Promise<Record<string, unknown>[]> {
  const { nearestEligibleVessel } = await import('./infill.js');
  const rows = (await c.query(`SELECT * FROM holidays WHERE mission_id = $1`, [missionId])).rows;
  rows.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
    Number(String(a.label).slice(1)) - Number(String(b.label).slice(1)));
  const out: Record<string, unknown>[] = [];
  for (const h of rows) {
    const cells = (await c.query(`SELECT col, row FROM holiday_cells WHERE holiday_id = $1 ORDER BY col, row`, [h.id])).rows
      .map((r: Record<string, unknown>) => [r.col, r.row]);
    let nearest: { id: string; name: string } | null = null;
    if (!client && (h.status === 'Open' || h.status === 'Queued')) {
      nearest = await nearestEligibleVessel(c, missionId, h.centroid as { easting: number; northing: number });
    }
    out.push({
      id: h.id, label: h.label, status: h.status,
      area_m2: h.area_m2, cell_count: h.cell_count,
      centroid: h.centroid, cells,
      nearest_vessel: nearest,
      infill_line_id: h.infill_line_id,
    });
  }
  return out;
}
