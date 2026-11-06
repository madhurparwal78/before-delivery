// Vessel conditions that raise and clear alerts: geofence excursions and service overdue.
import type { Db } from "./db.js";
import { one } from "./db.js";
import { clearAlert, openAlert, raiseAlert } from "./alerts.js";
import { insideConvex, vec, type Position } from "./geometry.js";
import { SYSTEM } from "./history.js";
import type { ExcursionRecord, MissionRecord, PlacedVessel, VesselRecord } from "./records.js";
import { overdue } from "./vessels.js";

export const ACTIVE = ["Launched", "Surveying", "Recovering"];
export const OPEN = ["Planned", ...ACTIVE];

/** A point on the fence counts as inside. */
const insideFence = (fence: Position[], p: Position) => insideConvex(fence.map(vec), vec(p), 1e-9);

/**
 * One breach alert per excursion: the first fix strictly outside starts it, a fix inside (or on) ends it
 * and clears the alert. Only afloat vessels on an active mission start excursions.
 */
export async function evaluateExcursion(db: Db, vessel: VesselRecord, mission: MissionRecord, p: Position, by = SYSTEM): Promise<void> {
  const open = await one<ExcursionRecord>(db, "SELECT * FROM excursions WHERE vessel_id = $1 AND mission_id = $2 AND ended_at IS NULL", [vessel.id, mission.id]);
  if (insideFence(mission.geofence, p)) {
    if (!open) return;
    await db.query("UPDATE excursions SET ended_at = $2 WHERE id = $1", [open.id, new Date()]);
    await clearAlert(db, open.alert_id, by);
    return;
  }
  if (open || !vessel.afloat || !ACTIVE.includes(mission.status)) return;
  const alert = await raiseAlert(db, "geofence_breach", vessel, mission.id, p);
  await db.query("INSERT INTO excursions (vessel_id, mission_id, alert_id) VALUES ($1,$2,$3)", [vessel.id, mission.id, alert.id]);
}

/** One service-overdue alert per overdue spell of an afloat vessel on an open mission; cleared when it ends. */
export async function evaluateOverdue(db: Db, vessel: PlacedVessel): Promise<void> {
  const isOverdue = overdue(vessel);
  if (isOverdue && !vessel.overdue_alerted && vessel.afloat && vessel.mission_id) {
    const position = vessel.last_fix_t ? { easting: vessel.last_easting, northing: vessel.last_northing } : null;
    await raiseAlert(db, "service_overdue", vessel, vessel.mission_id, position);
    await db.query("UPDATE vessels SET overdue_alerted = true WHERE id = $1", [vessel.id]);
  } else if (!isOverdue && vessel.overdue_alerted) {
    await db.query("UPDATE vessels SET overdue_alerted = false WHERE id = $1", [vessel.id]);
    const alert = await openAlert(db, "service_overdue", vessel.id);
    if (alert) await clearAlert(db, alert.id);
  }
}
