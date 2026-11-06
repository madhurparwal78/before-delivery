import { alertHeading } from '../shared/copy.js';
import { fixed } from '../shared/numbers.js';
import type { AlertKind, Position } from '../shared/types.js';
import { config } from './config.js';
import { newId, type Db } from './db.js';
import { containsPoint } from './domain/geometry.js';
import { decideLinkState } from './domain/linkState.js';
import { isOverdue } from './domain/overdue.js';
import { alertTransition, historyEntry, isMissionActive, SYSTEM_ACTOR } from './domain/transitions.js';
import { recordEvent } from './events.js';
import { queueEmail } from './outbox.js';
import {
  findMission,
  latestFix,
  listVessels,
  openMissionOfVessel,
  usersByRole,
  type AlertRow,
  type FixRow,
  type MissionRow,
  type VesselRow,
} from './repo.js';

type SpellTable = 'excursions' | 'lost_spells' | 'overdue_spells';

const SPELL_FOR: Record<AlertKind, SpellTable> = {
  geofence_breach: 'excursions',
  link_lost: 'lost_spells',
  service_overdue: 'overdue_spells',
};

function consoleLink(missionId: string): string {
  return `${config.publicUrl}/missions/${missionId}`;
}

function alertSubject(kind: AlertKind, vessel: string, mission: string): string {
  return `${alertHeading(kind, vessel)} — ${mission}`;
}

async function alertRecipients(db: Db, kind: AlertKind): Promise<{ email: string }[]> {
  const roles =
    kind === 'service_overdue'
      ? (['principal_surveyor', 'launch_technician'] as const)
      : (['principal_surveyor'] as const);
  return usersByRole(db, [...roles]);
}

/**
 * Raises one alert for a condition spell, queues its staff email and records the
 * mission event. Called only when the spell is newly open.
 */
async function createAlert(
  db: Db,
  mission: MissionRow,
  vessel: VesselRow,
  kind: AlertKind,
  position: Position | null,
  now: Date,
): Promise<AlertRow> {
  const heading = alertHeading(kind, vessel.name);
  const id = newId('alert');
  const raised = alertTransition('Active', 'raise');
  const history = [historyEntry(raised!.next, now, SYSTEM_ACTOR)];
  const inserted = await db.query<AlertRow>(
    `INSERT INTO alerts (id, mission_id, vessel_id, kind, state, heading, raised_at, position,
       email_state, escalation_state, history)
     VALUES ($1,$2,$3,$4,'Active',$5,$6,$7,'Queued','None',$8) RETURNING *`,
    [
      id,
      mission.id,
      vessel.id,
      kind,
      heading,
      now.toISOString(),
      position ? JSON.stringify(position) : null,
      JSON.stringify(history),
    ],
  );
  const body = [
    `${heading} on ${mission.name}.`,
    position
      ? `Position E ${fixed(position.easting, 1)} m N ${fixed(position.northing, 1)} m`
      : 'Position unknown',
    `Server time ${now.toISOString()}`,
    `Open the mission console: ${consoleLink(mission.id)}`,
  ].join('\r\n');
  for (const recipient of await alertRecipients(db, kind)) {
    await queueEmail(db, {
      dedupeKey: `alert:${id}:${recipient.email}`,
      to: recipient.email,
      subject: alertSubject(kind, vessel.name, mission.name),
      body,
      alertId: id,
      purpose: 'alert',
    });
  }
  await recordEvent(db, mission.id, 'alert', SYSTEM_ACTOR, `${heading} Active`, now);
  return inserted.rows[0]!;
}

/** Applies a real alert state change, appending exactly one history entry. */
async function moveAlert(
  db: Db,
  alert: AlertRow,
  trigger: 'acknowledge' | 'clear',
  by: string,
  now: Date,
): Promise<AlertRow> {
  const next = alertTransition(alert.state, trigger);
  if (!next) return alert;
  const entry = historyEntry(next.next, now, by);
  const acknowledging = trigger === 'acknowledge';
  const updated = await db.query<AlertRow>(
    `UPDATE alerts SET state = $2,
       history = history || $3::jsonb,
       acknowledged_at = CASE WHEN $4 THEN $5 ELSE acknowledged_at END,
       acknowledged_by = CASE WHEN $4 THEN $6 ELSE acknowledged_by END,
       rectified_at = CASE WHEN $4 THEN rectified_at ELSE $5 END
     WHERE id = $1 AND state = $7 RETURNING *`,
    [
      alert.id,
      next.next,
      JSON.stringify([entry]),
      acknowledging,
      now.toISOString(),
      acknowledging ? by : null,
      alert.state,
    ],
  );
  const row = updated.rows[0];
  if (!row) return alert;
  await recordEvent(db, alert.mission_id, 'alert', by, `${alert.heading} ${next.next}`, now);
  return row;
}

/**
 * Acknowledges an alert. Of simultaneous acknowledges exactly one is recorded,
 * because the update is guarded on the state it read.
 */
export async function acknowledgeAlert(
  db: Db,
  alert: AlertRow,
  actorName: string,
  now: Date,
): Promise<AlertRow> {
  return moveAlert(db, alert, 'acknowledge', actorName, now);
}

async function openSpell(
  db: Db,
  table: SpellTable,
  missionId: string,
  vesselId: string,
): Promise<{ id: string; alert_id: string | null } | null> {
  const result = await db.query<{ id: string; alert_id: string | null }>(
    `SELECT id, alert_id FROM ${table}
     WHERE mission_id = $1 AND vessel_id = $2 AND ended_at IS NULL LIMIT 1`,
    [missionId, vesselId],
  );
  return result.rows[0] ?? null;
}

/**
 * Starts a condition spell and raises its single alert, or does nothing when the
 * spell is already open. The unique partial state is held by the row itself, so
 * identical simultaneous fixes raise one alert only.
 */
async function startSpell(
  db: Db,
  kind: AlertKind,
  mission: MissionRow,
  vessel: VesselRow,
  position: Position | null,
  now: Date,
): Promise<void> {
  const table = SPELL_FOR[kind];
  const existing = await openSpell(db, table, mission.id, vessel.id);
  if (existing) return;
  const alert = await createAlert(db, mission, vessel, kind, position, now);
  await db.query(
    `INSERT INTO ${table} (id, mission_id, vessel_id, alert_id, started_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [newId('spell'), mission.id, vessel.id, alert.id, now.toISOString()],
  );
}

/** Ends a condition spell and moves its alert on, if the spell is open. */
async function endSpell(
  db: Db,
  kind: AlertKind,
  missionId: string,
  vesselId: string,
  now: Date,
  by: string,
): Promise<boolean> {
  const table = SPELL_FOR[kind];
  const existing = await openSpell(db, table, missionId, vesselId);
  if (!existing) return false;
  await db.query(`UPDATE ${table} SET ended_at = $2 WHERE id = $1`, [existing.id, now.toISOString()]);
  if (existing.alert_id) {
    const alert = await db.query<AlertRow>('SELECT * FROM alerts WHERE id = $1', [existing.alert_id]);
    const row = alert.rows[0];
    if (row) await moveAlert(db, row, 'clear', by, now);
  }
  return true;
}

/**
 * Evaluates the geofence and overdue conditions for a vessel after an accepted
 * fix, and ends any open lost spell.
 */
export async function evaluateAfterFix(
  db: Db,
  vessel: VesselRow,
  fix: FixRow,
  now: Date,
): Promise<void> {
  const mission = await openMissionOfVessel(db, vessel.id);
  if (!mission) return;
  const position: Position = { easting: fix.easting, northing: fix.northing };

  if (isMissionActive(mission.status)) {
    await endSpell(db, 'link_lost', mission.id, vessel.id, now, SYSTEM_ACTOR);
    if (vessel.afloat) {
      const inside = containsPoint(mission.geofence, position);
      if (inside) await endSpell(db, 'geofence_breach', mission.id, vessel.id, now, SYSTEM_ACTOR);
      else await startSpell(db, 'geofence_breach', mission, vessel, position, now);
    }
  }

  await evaluateOverdue(db, vessel, mission, position, now);
}

/** A vessel that becomes overdue while afloat on an open mission raises one alert. */
export async function evaluateOverdue(
  db: Db,
  vessel: VesselRow,
  mission: MissionRow,
  position: Position | null,
  now: Date,
): Promise<void> {
  const overdue = isOverdue(vessel.hours_since_service, vessel.service_interval_h);
  if (overdue && vessel.afloat) {
    await startSpell(db, 'service_overdue', mission, vessel, position, now);
  } else if (!overdue) {
    await endSpell(db, 'service_overdue', mission.id, vessel.id, now, SYSTEM_ACTOR);
  }
}

/**
 * The timer pass that follows link state. A vessel afloat on an active mission
 * that has gone Lost raises one link-lost alert, unless the mission is held.
 */
export async function evaluateLinkStates(db: Db, now: Date): Promise<void> {
  for (const vessel of await listVessels(db)) {
    const mission = await openMissionOfVessel(db, vessel.id);
    if (!mission || !isMissionActive(mission.status)) continue;
    const fix = await latestFix(db, vessel.id);
    const state = decideLinkState(fix ? fix.received_at : null, now);
    if (state === 'Lost' && vessel.afloat && fix !== null && mission.launched_at !== null) {
      const sentSinceLaunch = new Date(fix.received_at).getTime() >= new Date(mission.launched_at).getTime();
      if (sentSinceLaunch && mission.hold === null) {
        await startSpell(
          db,
          'link_lost',
          mission,
          vessel,
          { easting: fix.easting, northing: fix.northing },
          now,
        );
      }
    }
    const overdueMission = mission;
    await evaluateOverdue(db, vessel, overdueMission, fix ? { easting: fix.easting, northing: fix.northing } : null, now);
  }
}

/** Resuming a held mission raises the link-lost alert of any vessel already Lost. */
export async function raiseHeldLinkAlerts(db: Db, missionId: string, now: Date): Promise<void> {
  const mission = await findMission(db, missionId);
  if (!mission || !isMissionActive(mission.status)) return;
  for (const vessel of await listVessels(db)) {
    const open = await openMissionOfVessel(db, vessel.id);
    if (!open || open.id !== missionId) continue;
    const fix = await latestFix(db, vessel.id);
    if (!fix || !vessel.afloat) continue;
    if (decideLinkState(fix.received_at, now) !== 'Lost') continue;
    await startSpell(db, 'link_lost', mission, vessel, { easting: fix.easting, northing: fix.northing }, now);
  }
}

/**
 * A geofence changed mid-survey re-evaluates every vessel's open breach at once:
 * a vessel now inside has its breach cleared, and one now outside raises a new
 * breach exactly as a fix would.
 */
export async function evaluateGeofenceChange(
  db: Db,
  missionId: string,
  actorName: string,
  now: Date,
): Promise<void> {
  const mission = await findMission(db, missionId);
  if (!mission) return;
  for (const vessel of await listVessels(db)) {
    const open = await openMissionOfVessel(db, vessel.id);
    if (!open || open.id !== missionId) continue;
    const fix = await latestFix(db, vessel.id);
    if (!fix || !vessel.afloat) continue;
    const position: Position = { easting: fix.easting, northing: fix.northing };
    if (containsPoint(mission.geofence, position)) {
      await endSpell(db, 'geofence_breach', missionId, vessel.id, now, actorName);
    } else {
      await startSpell(db, 'geofence_breach', mission, vessel, position, now);
    }
  }
}

/** Aborting or completing a mission clears its breach and link-lost alerts. */
export async function clearMissionAlerts(db: Db, missionId: string, now: Date): Promise<void> {
  const vessels = await db.query<{ vessel_id: string }>(
    `SELECT DISTINCT vessel_id FROM alerts
     WHERE mission_id = $1 AND state IN ('Active','Acknowledged')
       AND kind IN ('geofence_breach','link_lost')`,
    [missionId],
  );
  for (const row of vessels.rows) {
    await endSpell(db, 'geofence_breach', missionId, row.vessel_id, now, SYSTEM_ACTOR);
    await endSpell(db, 'link_lost', missionId, row.vessel_id, now, SYSTEM_ACTOR);
  }
}

/** Only an alert still Active once the escalation delay has passed escalates. */
export async function escalateAlerts(db: Db, now: Date): Promise<void> {
  const due = await db.query<AlertRow & { mission_name: string; vessel_name: string }>(
    `SELECT a.*, m.name AS mission_name, v.name AS vessel_name
     FROM alerts a JOIN missions m ON m.id = a.mission_id JOIN vessels v ON v.id = a.vessel_id
     WHERE a.state = 'Active' AND a.escalation_state = 'None'
       AND a.raised_at <= $1`,
    [new Date(now.getTime() - config.escalationSeconds * 1000).toISOString()],
  );
  for (const alert of due.rows) {
    const claimed = await db.query(
      `UPDATE alerts SET escalation_state = 'Queued'
       WHERE id = $1 AND state = 'Active' AND escalation_state = 'None'`,
      [alert.id],
    );
    if (claimed.rowCount === 0) continue;
    const position = alert.position;
    const body = [
      `${alert.heading} on ${alert.mission_name} is still active.`,
      position
        ? `Position E ${fixed(position.easting, 1)} m N ${fixed(position.northing, 1)} m`
        : 'Position unknown',
      `Server time ${now.toISOString()}`,
      `Open the mission console: ${consoleLink(alert.mission_id)}`,
    ].join('\r\n');
    for (const recipient of await usersByRole(db, ['principal_surveyor', 'launch_technician'])) {
      await queueEmail(db, {
        dedupeKey: `esc:${alert.id}:${recipient.email}`,
        to: recipient.email,
        subject: `Escalation: ${alertSubject(alert.kind, alert.vessel_name, alert.mission_name)}`,
        body,
        alertId: alert.id,
        purpose: 'escalation',
      });
    }
  }
}
