import type { LinkState } from '../shared/types.js';
import type { Db } from './db.js';
import { MAX_FIX_GAP_S, MIN_RUNNING_SPEED_MPS } from './domain/coverage.js';
import { decideLinkState } from './domain/linkState.js';
import { evaluateAfterFix } from './alerts.js';
import { conflict, validation } from './errors.js';
import { recomputeHolidays } from './state.js';
import {
  findVessel,
  latestFix,
  openMissionOfVessel,
  runningLineOfVessel,
  type FixRow,
  type VesselRow,
} from './repo.js';

export interface FixInput {
  t: string;
  easting: number;
  northing: number;
  heading_deg: number;
  speed_mps: number;
  battery_pct: number;
  depth_m: number;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Validates one fix body, keyed with the given prefix for a batch index. */
export function validateFix(value: unknown, prefix: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const fix = (value ?? {}) as Record<string, unknown>;
  const t = fix.t;
  if (typeof t !== 'string' || !ISO_UTC.test(t) || Number.isNaN(Date.parse(t))) {
    errors[`${prefix}t`] = 'Send t as an ISO 8601 UTC time';
  }
  if (typeof fix.easting !== 'number' || !Number.isFinite(fix.easting)) {
    errors[`${prefix}easting`] = 'Send easting in metres';
  }
  if (typeof fix.northing !== 'number' || !Number.isFinite(fix.northing)) {
    errors[`${prefix}northing`] = 'Send northing in metres';
  }
  const heading = fix.heading_deg;
  if (typeof heading !== 'number' || !Number.isFinite(heading) || heading < 0 || heading >= 360) {
    errors[`${prefix}heading_deg`] = 'Heading must be at least 0 and below 360';
  }
  const speed = fix.speed_mps;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 20) {
    errors[`${prefix}speed_mps`] = 'Speed must be between 0 and 20 m/s';
  }
  const battery = fix.battery_pct;
  if (typeof battery !== 'number' || !Number.isFinite(battery) || battery < 0 || battery > 100) {
    errors[`${prefix}battery_pct`] = 'Battery must be between 0 and 100 %';
  }
  const depth = fix.depth_m;
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth <= 0 || depth > 500) {
    errors[`${prefix}depth_m`] = 'Depth must be above 0 and at most 500 m';
  }
  return errors;
}

export function asFixInput(value: unknown): FixInput {
  const fix = value as Record<string, unknown>;
  return {
    t: String(fix.t),
    easting: Number(fix.easting),
    northing: Number(fix.northing),
    heading_deg: Number(fix.heading_deg),
    speed_mps: Number(fix.speed_mps),
    battery_pct: Number(fix.battery_pct),
    depth_m: Number(fix.depth_m),
  };
}

/**
 * Thruster hours grow only from a fix interval of at most 60 seconds while the
 * vessel runs a line faster than 0.3 m/s. Over-speed and off-heading pairs count.
 */
export function thrusterHourGrowth(
  previous: FixRow | null,
  fix: { t: Date; speed_mps: number },
  runningLineId: string | null,
): number {
  if (previous === null || runningLineId === null) return 0;
  if (fix.speed_mps <= MIN_RUNNING_SPEED_MPS) return 0;
  const gapSeconds = (fix.t.getTime() - new Date(previous.t).getTime()) / 1000;
  if (!(gapSeconds > 0 && gapSeconds <= MAX_FIX_GAP_S)) return 0;
  return gapSeconds / 3600;
}

/**
 * Stores one new fix, grows thruster hours, then re-evaluates the vessel's alerts
 * and the mission's holidays. Callers hold the vessel's advisory lock.
 */
export async function applyFix(db: Db, vesselId: string, input: FixInput, now: Date): Promise<FixRow> {
  const running = await runningLineOfVessel(db, vesselId);
  const previous = await latestFix(db, vesselId);
  const t = new Date(input.t);
  const inserted = await db.query<FixRow>(
    `INSERT INTO fixes (vessel_id, t, received_at, easting, northing, heading_deg, speed_mps,
       battery_pct, depth_m, line_id, mission_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      vesselId,
      t.toISOString(),
      now.toISOString(),
      input.easting,
      input.northing,
      input.heading_deg,
      input.speed_mps,
      input.battery_pct,
      input.depth_m,
      running ? running.id : null,
      running ? running.mission_id : null,
    ],
  );
  const fix = inserted.rows[0]!;

  const growth = thrusterHourGrowth(previous, { t, speed_mps: input.speed_mps }, running ? running.id : null);
  if (growth > 0) {
    await db.query(
      `UPDATE vessels SET thruster_hours_total = thruster_hours_total + $2,
         hours_since_service = hours_since_service + $2 WHERE id = $1`,
      [vesselId, growth],
    );
  }

  const vessel = await findVessel(db, vesselId);
  if (vessel) await evaluateAfterFix(db, vessel, fix, now);
  if (running) await recomputeHolidays(db, running.mission_id);
  return fix;
}

export async function fixExists(db: Db, vesselId: string, t: string): Promise<boolean> {
  const result = await db.query<{ one: number }>(
    'SELECT 1 AS one FROM fixes WHERE vessel_id = $1 AND t = $2',
    [vesselId, new Date(t).toISOString()],
  );
  return result.rows.length > 0;
}

export async function linkStateOf(db: Db, vesselId: string, now: Date): Promise<LinkState> {
  const fix = await latestFix(db, vesselId);
  return decideLinkState(fix ? fix.received_at : null, now);
}

export async function latestT(db: Db, vesselId: string): Promise<Date | null> {
  const fix = await latestFix(db, vesselId);
  return fix ? new Date(fix.t) : null;
}

export function outOfOrder(): never {
  throw conflict('out_of_order', "This fix is older than the vessel's latest fix");
}

export function staleFix(index: number): never {
  throw conflict(
    'stale_fix',
    "A fix in this batch is older than the vessel's latest fix",
    { index },
  );
}

export function fixValidation(errors: Record<string, string>): never {
  throw validation(errors);
}

export { openMissionOfVessel };
export type { VesselRow };
