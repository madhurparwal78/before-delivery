import type { MissionEventKind } from '../../shared/types.js';
import { raiseHeldLinkAlerts } from '../alerts.js';
import { newId, pool, withTransaction } from '../db.js';
import { containsPoint, isConvex } from '../domain/geometry.js';
import { conflict, notFound, validation } from '../errors.js';
import { recordEvent } from '../events.js';
import { jsonObject, requireUser, sendJson, type Ctx, type Router } from '../http.js';
import { queueEmail } from '../outbox.js';
import { findLine, findMission, findUserById, toLine, type MissionRow } from '../repo.js';
import type { Position } from '../../shared/types.js';
import { loadMissionState } from '../state.js';
import { lockRecord, missionInScope, rolesOnly, staffOnly } from './guards.js';
import { missionWithOwner, requireOwner } from './missions.js';
import { evaluateGeofenceChange } from '../alerts.js';

const EVENT_KINDS: MissionEventKind[] = [
  'created',
  'assignments',
  'status',
  'line',
  'file',
  'alert',
  'infill',
  'owner',
  'hold',
  'geofence',
  'rerun',
];

function readPositions(value: unknown): Position[] | null {
  if (!Array.isArray(value)) return null;
  const points: Position[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const point = item as Record<string, unknown>;
    if (typeof point.easting !== 'number' || typeof point.northing !== 'number') return null;
    if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)) return null;
    points.push({ easting: point.easting, northing: point.northing });
  }
  return points;
}

function readVersion(body: Record<string, unknown>): number {
  const version = body.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw validation({ version: 'Send the mission version you last read' });
  }
  return version;
}

async function staleMission(mission: MissionRow, ctx: Ctx): Promise<never> {
  const user = requireUser(ctx);
  throw conflict('stale_version', `${mission.name} was changed by someone else.`, {
    current: await missionWithOwner(pool, mission.id, user, ctx.now),
  });
}

export function registerMissionOpsRoutes(router: Router): void {
  router.add({
    method: 'PUT',
    pattern: '/api/missions/:missionId/geofence',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      rolesOnly(user, ['principal_surveyor']);
      const body = jsonObject(ctx);
      const version = readVersion(body);

      const stale = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        await requireOwner(client, mission, user);
        if (mission.status !== 'Launched' && mission.status !== 'Surveying') {
          throw conflict('mission_not_active', 'This mission is not under way.');
        }
        if (mission.version !== version) return mission;

        const corners = readPositions(body.geofence);
        if (corners === null || corners.length < 3 || corners.length > 40) {
          throw validation({ geofence: 'Enter 3 to 40 geofence corners as easting, northing' });
        }
        if (!isConvex(corners)) {
          throw validation({ geofence: 'The geofence must be a convex shape' });
        }
        if (!mission.survey_area.every((vertex) => containsPoint(corners, vertex))) {
          throw validation({ geofence: 'The geofence must enclose the survey area' });
        }
        await client.query(
          'UPDATE missions SET geofence = $2, version = version + 1 WHERE id = $1',
          [missionId, JSON.stringify(corners)],
        );
        await recordEvent(client, missionId, 'geofence', user.name, 'Geofence changed', ctx.now);
        await evaluateGeofenceChange(client, missionId, user.name, ctx.now);
        return null;
      });
      if (stale) await staleMission(stale, ctx);
      sendJson(ctx.res, 200, await missionWithOwner(pool, missionId, user, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/hold',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      rolesOnly(user, ['principal_surveyor']);
      const reason = jsonObject(ctx).reason;

      await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        await requireOwner(client, mission, user);
        if (mission.status !== 'Surveying') {
          throw conflict('mission_not_surveying', 'Only a surveying mission can be held.');
        }
        if (mission.hold !== null) {
          throw conflict('mission_on_hold', 'This survey is already on hold.');
        }
        const running = await client.query<{ label: string }>(
          `SELECT label FROM lines WHERE mission_id = $1 AND status = 'Running' LIMIT 1`,
          [missionId],
        );
        if (running.rows[0]) {
          throw conflict('line_running', `${running.rows[0].label} is still running`);
        }
        if (typeof reason !== 'string' || reason.length < 3 || reason.length > 120) {
          throw validation({ reason: 'Give a reason of 3 to 120 characters' });
        }
        await client.query(
          'UPDATE missions SET hold = $2, version = version + 1 WHERE id = $1',
          [
            missionId,
            JSON.stringify({ reason, since: ctx.now.toISOString(), by: user.name }),
          ],
        );
        await recordEvent(client, missionId, 'hold', user.name, `Held: ${reason}`, ctx.now);
      });
      sendJson(ctx.res, 200, await missionWithOwner(pool, missionId, user, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/resume',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      rolesOnly(user, ['principal_surveyor']);
      await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        await requireOwner(client, mission, user);
        if (mission.hold === null) {
          throw conflict('mission_not_on_hold', 'This survey is not on hold.');
        }
        await client.query(
          'UPDATE missions SET hold = NULL, version = version + 1 WHERE id = $1',
          [missionId],
        );
        await recordEvent(client, missionId, 'hold', user.name, 'Resumed', ctx.now);
      });
      await raiseHeldLinkAlerts(pool, missionId, ctx.now);
      sendJson(ctx.res, 200, await missionWithOwner(pool, missionId, user, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/handover',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      rolesOnly(user, ['principal_surveyor']);
      const body = jsonObject(ctx);
      const toUserId = body.to_user_id;

      const stale = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        await requireOwner(client, mission, user);
        if (mission.status === 'Complete' || mission.status === 'Aborted') {
          throw conflict('mission_not_open', 'That mission is no longer open.');
        }
        const version = readVersion(body);
        if (mission.version !== version) return mission;

        const target = typeof toUserId === 'string' ? await findUserById(client, toUserId) : null;
        if (!target || target.role !== 'principal_surveyor' || target.id === mission.owner_id) {
          throw validation({ to_user_id: 'Choose another principal surveyor' });
        }
        await client.query(
          'UPDATE missions SET owner_id = $2, version = version + 1 WHERE id = $1',
          [missionId, target.id],
        );
        await recordEvent(client, missionId, 'owner', user.name, `Handed to ${target.name}`, ctx.now);
        const stamp = `${ctx.now.toISOString().slice(0, 10)} ${ctx.now.toISOString().slice(11, 16)}`;
        await queueEmail(client, {
          dedupeKey: `handover:${missionId}:${mission.version}:${target.email}`,
          to: target.email,
          subject: `${mission.name} handed to you`,
          body: `${user.name} handed ${mission.name} to you at ${stamp} UTC.\r\n`,
          purpose: 'handover',
        });
        return null;
      });
      if (stale) await staleMission(stale, ctx);
      sendJson(ctx.res, 200, await missionWithOwner(pool, missionId, user, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/lines/:lineId/rerun',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      const lineId = ctx.params.lineId!;
      await missionInScope(pool, user, missionId);
      const original = await findLine(pool, lineId);
      if (!original || original.mission_id !== missionId) throw notFound();
      rolesOnly(user, ['principal_surveyor']);
      const reason = jsonObject(ctx).reason;

      const created = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        await requireOwner(client, mission, user);
        if (mission.status !== 'Launched' && mission.status !== 'Surveying') {
          throw conflict('mission_not_active', 'This mission is not under way.');
        }
        const line = await findLine(client, lineId);
        if (!line) throw notFound();
        if (line.kind === 'infill' || (line.status !== 'Surveyed' && line.status !== 'Delivered')) {
          throw conflict('illegal_transition', `${line.label} cannot be re-run`);
        }
        const existing = await client.query<{ status: string }>(
          `SELECT status FROM lines WHERE rerun_of = $1`,
          [lineId],
        );
        if (existing.rows.some((row) => row.status !== 'Delivered')) {
          throw conflict('rerun_open', `${line.label} already has an open re-run`);
        }
        const trimmed = typeof reason === 'string' ? reason.trim() : '';
        if (trimmed.length < 3 || trimmed.length > 200) {
          throw validation({ reason: 'Give a reason of 3 to 200 characters' });
        }
        const sequence = existing.rows.length + 1;
        const label = `${line.label}R${sequence}`;
        const id = newId('l');
        await client.query(
          `INSERT INTO lines (id, mission_id, label, kind, status, rerun_of, rerun_seq,
             start_e, start_n, end_e, end_n, length_m, label_num)
           VALUES ($1,$2,$3,$4,'Pending',$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            missionId,
            label,
            line.kind,
            lineId,
            sequence,
            line.start_e,
            line.start_n,
            line.end_e,
            line.end_n,
            line.length_m,
            line.label_num,
          ],
        );
        await client.query('UPDATE missions SET version = version + 1 WHERE id = $1', [missionId]);
        await recordEvent(client, missionId, 'rerun', user.name, `${label} added: ${trimmed}`, ctx.now);
        return id;
      });

      const state = await loadMissionState(pool, missionId, ctx.now);
      const line = state?.lines.find((item) => item.id === created);
      if (!line) throw notFound();
      sendJson(ctx.res, 201, { line: toLine(line, null, 0) });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/history',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      staffOnly(user);

      const raw = ctx.query.get('kinds');
      let kinds: MissionEventKind[] | null = null;
      if (raw !== null && raw.length > 0) {
        const parts = raw.split(',').map((part) => part.trim());
        if (parts.some((part) => !EVENT_KINDS.includes(part as MissionEventKind))) {
          throw validation({ kinds: 'Choose kinds from the published list' });
        }
        kinds = parts as MissionEventKind[];
      }
      const before = ctx.query.get('before');

      const result = await pool.query<{
        seq: string;
        at: Date;
        kind: MissionEventKind;
        actor: string;
        summary: string;
      }>(
        `SELECT seq, at, kind, actor, summary FROM mission_events
         WHERE mission_id = $1
           AND ($2::text[] IS NULL OR kind = ANY($2))
           AND ($3::bigint IS NULL OR seq < $3)
         ORDER BY at DESC, seq DESC LIMIT 51`,
        [missionId, kinds, before === null ? null : before],
      );
      const page = result.rows.slice(0, 50);
      sendJson(ctx.res, 200, {
        events: page.map((row) => ({
          seq: Number(row.seq),
          at: row.at.toISOString(),
          kind: row.kind,
          actor: row.actor,
          summary: row.summary,
        })),
        next: result.rows.length > 50 ? Number(page[page.length - 1]!.seq) : null,
      });
    },
  });
}
