// Alerts: raising, clearing and acknowledging, each move with its history entry and mission event.
import type { Db } from "./db.js";
import { one, only, rows } from "./db.js";
import { recordEvent, SYSTEM } from "./history.js";
import { queueAlertMail } from "./mail.js";
import { newId } from "./passwords.js";
import type { AlertHistoryEntry, AlertKind, AlertRecord, AlertView, UserRecord, VesselRecord } from "./records.js";

const HEADINGS: Record<AlertKind, string> = {
  geofence_breach: "Geofence breach",
  link_lost: "Link lost",
  service_overdue: "Service overdue",
};

export async function raiseAlert(db: Db, kind: AlertKind, vessel: VesselRecord, missionId: string, position: { easting: number; northing: number } | null): Promise<AlertRecord> {
  const at = new Date();
  const heading = `${HEADINGS[kind]} — ${vessel.name}`;
  const history: AlertHistoryEntry[] = [{ state: "Active", at: at.toISOString(), by: SYSTEM }];
  const alert = await only<AlertRecord>(db,
    `INSERT INTO alerts (id, kind, state, heading, vessel_id, mission_id, raised_at, easting, northing, history)
     VALUES ($1,$2,'Active',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [newId("a"), kind, heading, vessel.id, missionId, at, position?.easting ?? null, position?.northing ?? null, JSON.stringify(history)]);
  const mission = await only<{ name: string }>(db, "SELECT name FROM missions WHERE id = $1", [missionId]);
  await queueAlertMail(db, { ...alert, vessel_name: vessel.name }, mission.name);
  await recordEvent(db, missionId, "alert", SYSTEM, `${heading} Active`, at);
  return alert;
}

/** The condition cleared: Active → Rectified, Acknowledged → Closed. */
export async function clearAlert(db: Db, alertId: string, by = SYSTEM): Promise<void> {
  const a = await one<AlertRecord>(db, "SELECT * FROM alerts WHERE id = $1 FOR UPDATE", [alertId]);
  if (!a || (a.state !== "Active" && a.state !== "Acknowledged")) return;
  const at = new Date();
  const state = a.state === "Active" ? "Rectified" : "Closed";
  const history = [...a.history, { state, at: at.toISOString(), by }];
  await db.query("UPDATE alerts SET state = $2, rectified_at = $3, history = $4 WHERE id = $1", [a.id, state, at, JSON.stringify(history)]);
  await recordEvent(db, a.mission_id, "alert", by, `${a.heading} ${state}`, at);
}

/** Acknowledging: Active → Acknowledged, Rectified → Closed; anything else is returned unchanged. */
export async function acknowledge(db: Db, alertId: string, user: UserRecord): Promise<AlertRecord> {
  const a = await only<AlertRecord>(db, "SELECT * FROM alerts WHERE id = $1 FOR UPDATE", [alertId]);
  if (a.state !== "Active" && a.state !== "Rectified") return a;
  const at = new Date();
  const state = a.state === "Active" ? "Acknowledged" : "Closed";
  const history = [...a.history, { state, at: at.toISOString(), by: user.name }];
  await recordEvent(db, a.mission_id, "alert", user.name, `${a.heading} ${state}`, at);
  return only<AlertRecord>(db,
    "UPDATE alerts SET state = $2, acknowledged_at = $3, acknowledged_by = $4, history = $5 WHERE id = $1 RETURNING *",
    [a.id, state, at, user.name, JSON.stringify(history)]);
}

/** Aborting or completing a mission clears its breach and link-lost alerts. */
export async function clearMissionAlerts(db: Db, missionId: string): Promise<void> {
  const open = await rows<{ id: string }>(db, "SELECT id FROM alerts WHERE mission_id = $1 AND kind IN ('geofence_breach','link_lost') AND state IN ('Active','Acknowledged') ORDER BY id", [missionId]);
  for (const a of open) await clearAlert(db, a.id);
  await db.query("UPDATE excursions SET ended_at = $2 WHERE mission_id = $1 AND ended_at IS NULL", [missionId, new Date()]);
}

export async function openAlert(db: Db, kind: AlertKind, vesselId: string): Promise<AlertRecord | null> {
  return one<AlertRecord>(db, "SELECT * FROM alerts WHERE kind = $1 AND vessel_id = $2 AND state IN ('Active','Acknowledged') ORDER BY seq DESC LIMIT 1", [kind, vesselId]);
}

export function alertJson(a: AlertView): Record<string, unknown> {
  return {
    id: a.id,
    kind: a.kind,
    state: a.state,
    heading: a.heading,
    vessel_id: a.vessel_id,
    vessel_name: a.vessel_name,
    mission_id: a.mission_id,
    raised_at: a.raised_at.toISOString(),
    rectified_at: a.rectified_at ? a.rectified_at.toISOString() : null,
    position: a.easting === null ? null : { easting: a.easting, northing: a.northing },
    acknowledged_at: a.acknowledged_at ? a.acknowledged_at.toISOString() : null,
    acknowledged_by: a.acknowledged_by ?? null,
    email: a.email_state,
    escalation: a.escalation_state,
    history: a.history,
  };
}
