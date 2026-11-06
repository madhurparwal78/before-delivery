import type pg from 'pg';
import { apiError } from './http.js';
import { Position, linkStateFromAge, LinkState, pointInsideOrOnEdge } from './domain.js';
import {
  FixRow, raiseAlert, clearAlert, recordEvent,
  isMissionActive,
} from './core.js';

// ---------------- fix validation ----------------

export interface FixInput {
  t: string; easting: unknown; northing: unknown; heading_deg: unknown;
  speed_mps: unknown; battery_pct: unknown; depth_m: unknown;
}

export function validateFix(f: FixInput, prefix: string): { errors: Record<string, string>; t: Date | null } {
  const errors: Record<string, string> = {};
  let t: Date | null = null;
  if (typeof f.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(f.t)) {
    t = new Date(f.t);
    if (Number.isNaN(t.getTime())) { errors[`${prefix}t`] = 'Send t as an ISO 8601 UTC time'; t = null; }
  } else {
    errors[`${prefix}t`] = 'Send t as an ISO 8601 UTC time';
  }
  for (const [k, v] of [['easting', f.easting], ['northing', f.northing]] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v)) errors[`${prefix}${k}`] = `Send ${k} in metres`;
  }
  const h = f.heading_deg;
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h >= 360) errors[`${prefix}heading_deg`] = 'Heading must be at least 0 and below 360';
  const s = f.speed_mps;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 20) errors[`${prefix}speed_mps`] = 'Speed must be between 0 and 20 m/s';
  const b = f.battery_pct;
  if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || b > 100) errors[`${prefix}battery_pct`] = 'Battery must be between 0 and 100 %';
  const d = f.depth_m;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0 || d > 500) errors[`${prefix}depth_m`] = 'Depth must be above 0 and at most 500 m';
  return { errors, t };
}

// ---------------- apply one accepted fix ----------------

async function vesselRunningLine(c: pg.PoolClient, vesselId: string): Promise<string | null> {
  const r = await c.query(`SELECT id FROM lines WHERE vessel_id = $1 AND status = 'Running' LIMIT 1`, [vesselId]);
  return r.rows[0]?.id ?? null;
}

export interface IngestContext {
  c: pg.PoolClient;
  vessel: { id: string; name: string; afloat: boolean; hours_since_service: number; service_interval_h: number };
  missionId: string | null; // open mission with lines on this vessel
}

async function openMissionForVessel(c: pg.PoolClient, vesselId: string): Promise<string | null> {
  const r = await c.query(
    `SELECT DISTINCT m.id FROM missions m JOIN lines l ON l.mission_id = m.id
     WHERE l.vessel_id = $1 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`,
    [vesselId]);
  return r.rows[0]?.id ?? null;
}

export async function applyFix(ctx: IngestContext, f: FixRow): Promise<{ link: LinkState; coverageMission: string | null }> {
  const { c, vessel } = ctx;
  const now = new Date();
  const lineId = await vesselRunningLine(c, vessel.id);

  // Store the fix (line_id = current running line, even if null)
  await c.query(
    `INSERT INTO fixes (vessel_id, t, received_at, easting, northing, heading_deg, speed_mps, battery_pct, depth_m, line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [vessel.id, f.t, now, f.easting, f.northing, f.heading_deg, f.speed_mps, f.battery_pct, f.depth_m, lineId]
  );

  // Thruster hours: grows between consecutive accepted fixes A,B when B arrives while a line runs,
  // B's speed > 0.3 and dt in (0, 60].
  if (lineId && f.speed_mps > 0.3) {
    const prev = await c.query(`SELECT t FROM fixes WHERE vessel_id = $1 AND t < $2 ORDER BY t DESC LIMIT 1`, [vessel.id, f.t]);
    if (prev.rows.length > 0) {
      const dt = (f.t.getTime() - new Date(prev.rows[0]!.t).getTime()) / 1000;
      if (dt > 0 && dt <= 60) {
        const hours = dt / 3600;
        await c.query(`UPDATE vessels SET thruster_hours_total = thruster_hours_total + $2, hours_since_service = hours_since_service + $2 WHERE id = $1`,
          [vessel.id, hours]);
        vessel.hours_since_service += hours;
        // Service overdue alert
        await checkServiceOverdue(c, vessel, ctx.missionId);
      }
    }
  }

  // Geofence / mission-dependent alerts
  if (ctx.missionId) {
    const m = (await c.query(`SELECT status, geofence, hold FROM missions WHERE id = $1`, [ctx.missionId])).rows[0]!;
    if (isMissionActive(m.status)) {
      await c.query(
        `INSERT INTO alert_states (vessel_id, mission_id, has_fix_since_launch) VALUES ($1,$2,true)
         ON CONFLICT (vessel_id) DO UPDATE SET mission_id = $2, has_fix_since_launch = true`,
        [vessel.id, ctx.missionId]);
      const fence = m.geofence as Position[];
      const pos: Position = { easting: f.easting, northing: f.northing };
      const inside = pointInsideOrOnEdge(pos, fence);
      await applyBreachState(c, vessel, ctx.missionId, pos, inside);
      // A new accepted fix ends the lost spell and clears the link-lost alert.
      await clearLostSpell(c, vessel.id, now);
      // Vessel is Live again: any moved infill queue is handled by the Lost timer, not here.
    }
  }

  // Coverage is recomputed once per request by the caller, not per fix.
  const coverageMission = lineId
    ? (await c.query(`SELECT mission_id FROM lines WHERE id = $1`, [lineId])).rows[0]?.mission_id as string | undefined
    : undefined;

  const link = linkStateFromAge(0);
  return { link: 'Live', coverageMission: coverageMission ?? null };
}

export async function checkServiceOverdue(c: pg.PoolClient, vessel: { id: string; name: string; hours_since_service: number; service_interval_h: number }, missionId: string | null): Promise<void> {
  const overdue = vessel.hours_since_service > vessel.service_interval_h;
  const r = await c.query(`SELECT overdue_alert_id FROM alert_states WHERE vessel_id = $1`, [vessel.id]);
  const st = r.rows[0];
  if (overdue && !st?.overdue_alert_id) {
    const missionOpen = await c.query(
      `SELECT m.id, m.status FROM missions m JOIN lines l ON l.mission_id = m.id
       WHERE l.vessel_id = $1 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`, [vessel.id]);
    if (missionOpen.rows.length > 0) {
      const fix = await c.query(`SELECT easting, northing FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [vessel.id]);
      const pos = fix.rows[0] ? { easting: fix.rows[0]!.easting, northing: fix.rows[0]!.northing } : null;
      const alertId = await raiseAlert(c, 'service_overdue', vessel, missionOpen.rows[0]!.id as string, pos, new Date());
      if (!st) {
        await c.query(`INSERT INTO alert_states (vessel_id, mission_id, overdue_alert_id) VALUES ($1,$2,$3)`, [vessel.id, missionOpen.rows[0]!.id, alertId]);
      } else {
        await c.query(`UPDATE alert_states SET overdue_alert_id = $2 WHERE vessel_id = $1`, [vessel.id, alertId]);
      }
    }
  } else if (!overdue && st?.overdue_alert_id) {
    await clearAlert(c, st.overdue_alert_id, 'Swathdeck', new Date());
    await c.query(`UPDATE alert_states SET overdue_alert_id = NULL WHERE vessel_id = $1`, [vessel.id]);
  }
  void missionId;
}

async function applyBreachState(c: pg.PoolClient, vessel: { id: string; name: string }, missionId: string, pos: Position, inside: boolean): Promise<void> {
  const r = await c.query(`SELECT breach_alert_id FROM alert_states WHERE vessel_id = $1`, [vessel.id]);
  const st = r.rows[0];
  if (!inside && !st?.breach_alert_id) {
    const alertId = await raiseAlert(c, 'geofence_breach', vessel, missionId, pos, new Date());
    if (!st) await c.query(`INSERT INTO alert_states (vessel_id, mission_id, breach_alert_id) VALUES ($1,$2,$3)`, [vessel.id, missionId, alertId]);
    else await c.query(`UPDATE alert_states SET breach_alert_id = $2 WHERE vessel_id = $1`, [vessel.id, alertId]);
  } else if (inside && st?.breach_alert_id) {
    await clearAlert(c, st.breach_alert_id, 'Swathdeck', new Date());
    await c.query(`UPDATE alert_states SET breach_alert_id = NULL WHERE vessel_id = $1`, [vessel.id]);
  }
}

async function clearLostSpell(c: pg.PoolClient, vesselId: string, now: Date): Promise<void> {
  const r = await c.query(`SELECT lost_alert_id FROM alert_states WHERE vessel_id = $1`, [vesselId]);
  const st = r.rows[0];
  if (st?.lost_alert_id) {
    await clearAlert(c, st.lost_alert_id, 'Swathdeck', now);
    await c.query(`UPDATE alert_states SET lost_alert_id = NULL WHERE vessel_id = $1`, [vesselId]);
  }
}

// ---------------- link-state and alert timer ----------------

export async function runLinkTimer(): Promise<void> {
  const { withClient } = await import('./db.js');
  const { moveInfillOffLostVessel } = await import('./infill.js');
  await withClient(async (c) => {
    const vessels = await c.query(`SELECT id FROM vessels`);
    for (const v of vessels.rows) {
      const last = await c.query(`SELECT received_at FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [v.id]);
      const receivedAt = last.rows.length ? new Date(last.rows[0]!.received_at) : null;
      const state = receivedAt ? linkStateFromAge((Date.now() - receivedAt.getTime()) / 1000) : 'Lost';

      // Infill move when a vessel becomes Lost
      if (state === 'Lost') {
        await moveInfillOffLostVessel(c, v.id as string);
      }

      // Link-lost alert
      const st = (await c.query(`SELECT * FROM alert_states WHERE vessel_id = $1`, [v.id])).rows[0];
      if (!st) continue;
      const vrow = (await c.query(`SELECT name, afloat FROM vessels WHERE id = $1`, [v.id])).rows[0]!;
      if (!vrow.afloat) continue;
      const missionId = st.mission_id as string | null;
      if (!missionId) continue;
      const m = (await c.query(`SELECT status, hold FROM missions WHERE id = $1`, [missionId])).rows[0];
      if (!m || !isMissionActive(m.status)) continue;
      if (m.hold) continue; // on hold suppresses link-lost alerts
      if (state === 'Lost' && !st.lost_alert_id && st.has_fix_since_launch) {
        const fix = await c.query(`SELECT easting, northing FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [v.id]);
        const pos = fix.rows[0] ? { easting: fix.rows[0]!.easting, northing: fix.rows[0]!.northing } : null;
        const alertId = await raiseAlert(c, 'link_lost', { id: v.id as string, name: vrow.name }, missionId, pos, new Date());
        await c.query(`UPDATE alert_states SET lost_alert_id = $2 WHERE vessel_id = $1`, [v.id, alertId]);
      }
    }
  });
}
