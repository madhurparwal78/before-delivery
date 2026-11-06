import { afloatServiceCopy, overdueBlockMessage, staleVersionCopy } from '../../shared/copy.js';
import { newId, pool, withTransaction } from '../db.js';
import { isOverdue, validServiceInterval } from '../domain/overdue.js';
import { conflict, validation } from '../errors.js';
import { jsonObject, requireUser, sendJson, type Router } from '../http.js';
import { evaluateOverdue } from '../alerts.js';
import {
  isoOf,
  latestFix,
  listServices,
  openMissionOfVessel,
  recentFixes,
  runningLineOfVessel,
  toVessel,
  vesselRecords,
  type VesselRow,
} from '../repo.js';
import { idempotencyKey, lockRecord, rolesOnly, runIdempotent, staffOnly, vesselOr404 } from './guards.js';

async function vesselRecord(vesselId: string, now: Date): Promise<ReturnType<typeof toVessel>> {
  const row = await vesselOr404(pool, vesselId);
  const [mission, running, fix] = await Promise.all([
    openMissionOfVessel(pool, vesselId),
    runningLineOfVessel(pool, vesselId),
    latestFix(pool, vesselId),
  ]);
  return toVessel(
    row,
    {
      openMissionId: mission ? mission.id : null,
      runningLineId: running ? running.id : null,
      lastFix: fix,
    },
    now,
  );
}

/** The one overdue refusal, so every blocked action carries the same message. */
export function refuseIfOverdue(vessel: VesselRow): void {
  if (isOverdue(vessel.hours_since_service, vessel.service_interval_h)) {
    throw conflict(
      'service_overdue',
      overdueBlockMessage(vessel.name, vessel.hours_since_service, vessel.service_interval_h),
    );
  }
}

export function registerVesselRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/vessels',
    body: 'none',
    handler: async (ctx) => {
      staffOnly(requireUser(ctx));
      sendJson(ctx.res, 200, await vesselRecords(pool, ctx.now));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/vessels/:vesselId',
    body: 'none',
    handler: async (ctx) => {
      await vesselOr404(pool, ctx.params.vesselId!);
      staffOnly(requireUser(ctx));
      sendJson(ctx.res, 200, await vesselRecord(ctx.params.vesselId!, ctx.now));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/vessels/:vesselId/fixes',
    body: 'none',
    handler: async (ctx) => {
      await vesselOr404(pool, ctx.params.vesselId!);
      staffOnly(requireUser(ctx));
      const raw = ctx.query.get('window_s');
      if (raw !== null && raw !== '600') {
        throw validation({ window_s: 'Send window_s as 600' });
      }
      const rows = await recentFixes(pool, ctx.params.vesselId!, raw === null ? null : 600);
      sendJson(
        ctx.res,
        200,
        rows.map((fix) => ({
          t: isoOf(fix.t),
          received_at: isoOf(fix.received_at),
          position: { easting: fix.easting, northing: fix.northing },
          heading_deg: fix.heading_deg,
          speed_mps: fix.speed_mps,
          battery_pct: fix.battery_pct,
          depth_m: fix.depth_m,
        })),
      );
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/vessels/:vesselId',
    body: 'json',
    handler: async (ctx) => {
      const vesselId = ctx.params.vesselId!;
      await vesselOr404(pool, vesselId);
      rolesOnly(requireUser(ctx), ['principal_surveyor']);
      const body = jsonObject(ctx);
      const version = body.version;
      if (typeof version !== 'number' || !Number.isInteger(version)) {
        throw validation({ version: 'Send the vessel version you last read' });
      }
      const record = await withTransaction(async (client) => {
        await lockRecord(client, 'vessel', vesselId);
        const current = await vesselOr404(client, vesselId);
        if (current.version !== version) {
          const context = {
            openMissionId: (await openMissionOfVessel(client, vesselId))?.id ?? null,
            runningLineId: (await runningLineOfVessel(client, vesselId))?.id ?? null,
            lastFix: await latestFix(client, vesselId),
          };
          throw conflict('stale_version', staleVersionCopy(current.name), {
            current: toVessel(current, context, ctx.now),
          });
        }
        const interval = body.service_interval_h;
        if (!validServiceInterval(interval)) {
          throw validation({
            service_interval_h: 'Service interval must be between 50 and 1000 h',
          });
        }
        const updated = await client.query<VesselRow>(
          `UPDATE vessels SET service_interval_h = $2, version = version + 1
           WHERE id = $1 RETURNING *`,
          [vesselId, interval],
        );
        const row = updated.rows[0]!;
        // A changed interval applies at once, in both directions.
        const mission = await openMissionOfVessel(client, vesselId);
        if (mission) {
          const fix = await latestFix(client, vesselId);
          await evaluateOverdue(
            client,
            row,
            mission,
            fix ? { easting: fix.easting, northing: fix.northing } : null,
            ctx.now,
          );
        }
        return row;
      });
      sendJson(ctx.res, 200, await vesselRecord(record.id, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/vessels/:vesselId/afloat',
    body: 'json',
    handler: async (ctx) => {
      const vesselId = ctx.params.vesselId!;
      await vesselOr404(pool, vesselId);
      rolesOnly(requireUser(ctx), ['launch_technician']);
      await withTransaction(async (client) => {
        await lockRecord(client, 'vessel', vesselId);
        const vessel = await vesselOr404(client, vesselId);
        if (vessel.afloat) return;
        refuseIfOverdue(vessel);
        const updated = await client.query<VesselRow>(
          'UPDATE vessels SET afloat = true, version = version + 1 WHERE id = $1 RETURNING *',
          [vesselId],
        );
        const mission = await openMissionOfVessel(client, vesselId);
        if (mission) {
          const fix = await latestFix(client, vesselId);
          await evaluateOverdue(
            client,
            updated.rows[0]!,
            mission,
            fix ? { easting: fix.easting, northing: fix.northing } : null,
            ctx.now,
          );
        }
      });
      sendJson(ctx.res, 200, await vesselRecord(vesselId, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/vessels/:vesselId/recovered',
    body: 'json',
    handler: async (ctx) => {
      const vesselId = ctx.params.vesselId!;
      await vesselOr404(pool, vesselId);
      rolesOnly(requireUser(ctx), ['launch_technician']);
      await withTransaction(async (client) => {
        await lockRecord(client, 'vessel', vesselId);
        const vessel = await vesselOr404(client, vesselId);
        const running = await runningLineOfVessel(client, vesselId);
        if (running) {
          throw conflict('line_running', `${vessel.name} is still running ${running.label}`);
        }
        if (!vessel.afloat) return;
        await client.query(
          'UPDATE vessels SET afloat = false, version = version + 1 WHERE id = $1',
          [vesselId],
        );
      });
      sendJson(ctx.res, 200, await vesselRecord(vesselId, ctx.now));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/vessels/:vesselId/services',
    body: 'json',
    handler: async (ctx) => {
      const vesselId = ctx.params.vesselId!;
      await vesselOr404(pool, vesselId);
      const user = staffOnly(requireUser(ctx));
      const key = idempotencyKey(ctx);
      const body = jsonObject(ctx);
      const result = await withTransaction(async (client) =>
        runIdempotent(client, user.id, 'services', key, ctx.body, async () => {
          await lockRecord(client, 'vessel', vesselId);
          const vessel = await vesselOr404(client, vesselId);
          if (vessel.afloat) {
            throw conflict('vessel_afloat', afloatServiceCopy(vessel.name));
          }
          const note = body.note;
          if (typeof note !== 'string' || note.length < 1 || note.length > 500) {
            throw validation({ note: 'Enter a service note of up to 500 characters' });
          }
          const id = newId('svc');
          const hoursAtService = vessel.hours_since_service;
          await client.query(
            `INSERT INTO services (id, vessel_id, logged_at, logged_by, hours_at_service, note)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, vesselId, ctx.now.toISOString(), user.name, hoursAtService, note],
          );
          const updated = await client.query<VesselRow>(
            `UPDATE vessels SET hours_since_service = 0, version = version + 1
             WHERE id = $1 RETURNING *`,
            [vesselId],
          );
          const mission = await openMissionOfVessel(client, vesselId);
          if (mission) {
            await evaluateOverdue(client, updated.rows[0]!, mission, null, ctx.now);
          }
          return {
            status: 201,
            payload: {
              id,
              vessel_id: vesselId,
              logged_at: ctx.now.toISOString(),
              logged_by: user.name,
              hours_at_service: hoursAtService,
              note,
            },
          };
        }),
      );
      sendJson(ctx.res, result.status, result.payload);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/vessels/:vesselId/services',
    body: 'none',
    handler: async (ctx) => {
      await vesselOr404(pool, ctx.params.vesselId!);
      staffOnly(requireUser(ctx));
      sendJson(ctx.res, 200, await listServices(pool, ctx.params.vesselId!));
    },
  });
}
