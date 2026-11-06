// Vessels: link state, the overdue check and the vessel record, each decided here only.
import type { Db } from "./db.js";
import { one, only, rows } from "./db.js";
import { conflict } from "./http.js";
import { fixed1, hours, plain } from "./numbers.js";
import type { PlacedVessel, VesselRecord } from "./records.js";

type LinkState = "Live" | "Stale" | "Lost";

/** Link state from the age of the last received fix, by the server's clock. */
export function linkState(lastReceivedAt: Date | null, now = Date.now()): LinkState {
  if (!lastReceivedAt) return "Lost";
  const age = (now - lastReceivedAt.getTime()) / 1000;
  if (age < 10) return "Live";
  return age <= 60 ? "Stale" : "Lost";
}

/** Overdue when hours since service (as recorded, to 0.001 h) are strictly greater than the vessel's own interval. */
export const overdue = (v: VesselRecord) => hours(v.hours_since_service) > v.service_interval_h;

function overdueMessage(v: VesselRecord): string {
  return `${v.name} is overdue for thruster service (${fixed1(hours(v.hours_since_service))} h since service, limit ${plain(v.service_interval_h)} h). Log a service before assigning or launching.`;
}

export const serviceOverdueError = (v: VesselRecord) => conflict("service_overdue", overdueMessage(v));

/** The open mission a vessel holds lines on, and its running line. */
const PLACEMENT = `
  SELECT v.*,
    (SELECT l.mission_id FROM lines l JOIN missions m ON m.id = l.mission_id
       WHERE l.vessel_id = v.id AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1) AS mission_id,
    (SELECT l.id FROM lines l WHERE l.vessel_id = v.id AND l.status = 'Running' LIMIT 1) AS running_line_id
  FROM vessels v`;

export async function loadVessels(db: Db): Promise<PlacedVessel[]> {
  return rows<PlacedVessel>(db, `${PLACEMENT} ORDER BY v.seed_order`);
}

/** A vessel that may not exist (an id from a request body), else null. */
export async function findVessel(db: Db, id: string, lock = false): Promise<PlacedVessel | null> {
  if (lock) await db.query("SELECT 1 FROM vessels WHERE id = $1 FOR UPDATE", [id]);
  return one<PlacedVessel>(db, `${PLACEMENT} WHERE v.id = $1`, [id]);
}

/** A vessel the caller already knows exists (checked, locked or referenced by a line). */
export async function loadVessel(db: Db, id: string, lock = false): Promise<PlacedVessel> {
  if (lock) await db.query("SELECT 1 FROM vessels WHERE id = $1 FOR UPDATE", [id]);
  return only<PlacedVessel>(db, `${PLACEMENT} WHERE v.id = $1`, [id]);
}

export function vesselJson(v: PlacedVessel): Record<string, unknown> {
  return {
    id: v.id,
    name: v.name,
    version: v.version,
    link_state: linkState(v.last_fix_received_at),
    last_fix_received_at: v.last_fix_received_at ? v.last_fix_received_at.toISOString() : null,
    last_fix: v.last_fix_t
      ? {
          t: v.last_fix_t.toISOString(),
          position: { easting: v.last_easting, northing: v.last_northing },
          heading_deg: v.last_heading,
          speed_mps: v.last_speed,
          battery_pct: v.last_battery,
          depth_m: v.last_depth,
        }
      : null,
    afloat: v.afloat,
    mission_id: v.mission_id ?? null,
    running_line_id: v.running_line_id ?? null,
    thruster_hours_total: hours(v.thruster_hours_total),
    hours_since_service: hours(v.hours_since_service),
    service_interval_h: v.service_interval_h,
    service_overdue: overdue(v),
  };
}

/** Names joined in alphabetical order, as the not-afloat and recover-every-vessel copy publish them. */
export const nameList = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b)).join(", ");
