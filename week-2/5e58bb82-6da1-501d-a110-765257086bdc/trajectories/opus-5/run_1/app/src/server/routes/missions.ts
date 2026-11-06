import {
  illegalMoveCopy,
  LINES_AWAITING_UPLOAD_COPY,
  LINES_UNASSIGNED_COPY,
  MISSION_NOT_ASSIGNABLE_COPY,
  notAfloatCopy,
  overdueBlockMessage,
  recoverEveryVesselCopy,
  REASSIGN_ONLY_COPY,
  vesselCommittedCopy,
} from '../../shared/copy.js';
import type { MissionStatus } from '../../shared/types.js';
import { clearMissionAlerts } from '../alerts.js';
import { newId, pool, withTransaction, type Db } from '../db.js';
import { derivePlan } from '../domain/plan.js';
import { isOverdue } from '../domain/overdue.js';
import {
  isMissionActive,
  lineAssignable,
  lineRemaining,
  missionAssignable,
  missionEdgeRequestable,
} from '../domain/transitions.js';
import { conflict, illegalTransition, notFound, notMissionOwner, validation } from '../errors.js';
import { recordEvent } from '../events.js';
import { jsonObject, requireUser, sendJson, type Router } from '../http.js';
import { setMissionStatus } from '../missionFlow.js';
import {
  findMission,
  findOrg,
  findUserById,
  listLines,
  listMissions,
  listOrgs,
  listFixesForMission,
  listVessels,
  toLine,
  type LineRow,
  type MissionRow,
  type UserRow,
  type VesselRow,
} from '../repo.js';
import {
  coverageLines,
  lineRecords,
  loadMissionState,
  missionGeometry,
  missionRecord,
  missionSummary,
} from '../state.js';
import { computeCoverage } from '../domain/coverage.js';
import { idempotencyKey, lockRecord, lockVessels, missionInScope, rolesOnly, runIdempotent, staffOnly } from './guards.js';
import { validatePlan } from './planValidation.js';
import { writePendingReports } from '../report.js';

/** Counters for a mission summary row, decided by the same derivation as the console. */
async function summaryCounters(mission: MissionRow): Promise<ReturnType<typeof missionSummary>['counters']> {
  const [lines, fixes, holidays] = await Promise.all([
    listLines(pool, mission.id),
    listFixesForMission(pool, mission.id),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM holidays WHERE mission_id = $1 AND status = 'Open'`,
      [mission.id],
    ),
  ]);
  const coverage = computeCoverage(
    missionGeometry(mission),
    coverageLines(lines),
    fixes.map((fix) => ({
      vessel_id: fix.vessel_id,
      line_id: fix.line_id,
      t: new Date(fix.t).getTime() / 1000,
      easting: fix.easting,
      northing: fix.northing,
      heading_deg: fix.heading_deg,
      speed_mps: fix.speed_mps,
      depth_m: fix.depth_m,
    })),
  );
  return {
    coverage_pct: coverage.coveragePct,
    open_holidays: Number(holidays.rows[0]?.count ?? '0'),
    lines_remaining: lines.filter((line) => lineRemaining(line.status)).length,
  };
}

/** Reads the mission record through the given connection, so a freshly inserted
 * mission is visible to its own transaction. */
export async function missionWithOwner(
  db: Db,
  missionId: string,
  user: UserRow,
  now: Date,
): Promise<ReturnType<typeof missionRecord>> {
  const state = await loadMissionState(db, missionId, now);
  if (!state) throw notFound();
  const record = missionRecord(state, user.role);
  const owner = await findUserById(db, state.mission.owner_id);
  return { ...record, owner_name: owner ? owner.name : '' };
}

/** An owner-only action answers 403 not_mission_owner to any other surveyor. */
export async function requireOwner(
  db: Parameters<typeof findUserById>[0],
  mission: MissionRow,
  user: UserRow,
): Promise<void> {
  if (mission.owner_id === user.id) return;
  const owner = await findUserById(db, mission.owner_id);
  throw notMissionOwner(owner ? owner.name : '', mission.name);
}

export function registerMissionRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/missions',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const scope = user.role === 'client_reviewer' ? user.client_org_id : null;
      const missions = await listMissions(pool, scope);
      const orgs = new Map((await listOrgs(pool)).map((org) => [org.id, org.name]));
      const rows = [];
      for (const mission of missions) {
        rows.push(
          missionSummary(
            mission,
            orgs.get(mission.client_org_id) ?? '',
            await summaryCounters(mission),
          ),
        );
      }
      sendJson(ctx.res, 200, rows);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/plan-preview',
    body: 'json',
    handler: async (ctx) => {
      rolesOnly(requireUser(ctx), ['principal_surveyor']);
      const { settings } = validatePlan(jsonObject(ctx), false);
      const plan = derivePlan(settings);
      sendJson(ctx.res, 200, {
        swath_width_m: plan.swath_width_m,
        line_spacing_m: plan.line_spacing_m,
        line_count: plan.line_count,
        crossline_count: plan.crossline_count,
        estimated_duration_s: plan.estimated_duration_s,
      });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions',
    body: 'json',
    handler: async (ctx) => {
      const body = jsonObject(ctx);
      const orgId = typeof body.client_org_id === 'string' ? body.client_org_id : '';
      if (!(await findOrg(pool, orgId))) throw notFound();
      const user = rolesOnly(requireUser(ctx), ['principal_surveyor']);
      const key = idempotencyKey(ctx);
      const result = await withTransaction(async (client) =>
        runIdempotent(client, user.id, 'missions', key, ctx.body, async () => {
          const { fields, settings } = validatePlan(body, true);
          const plan = derivePlan(settings);
          const missionId = newId('m');
          await client.query(
            `INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order,
               survey_area, geofence, planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg,
               planned_speed_mps, swath_width_m, line_spacing_m, line_count, crossline_count,
               estimated_duration_s, owner_id, version, report_state, created_at)
             VALUES ($1,$2,$3,$4,'Planned',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,'None',$19)`,
            [
              missionId,
              fields.name,
              orgId,
              fields.survey_date,
              settings.survey_order,
              JSON.stringify(settings.survey_area),
              JSON.stringify(fields.geofence),
              settings.planned_depth_m,
              settings.swath_ratio,
              settings.overlap_pct,
              settings.line_azimuth_deg,
              settings.planned_speed_mps,
              plan.swath_width_m,
              plan.line_spacing_m,
              plan.line_count,
              plan.crossline_count,
              plan.estimated_duration_s,
              user.id,
              ctx.now.toISOString(),
            ],
          );
          for (const line of plan.lines) {
            await client.query(
              `INSERT INTO lines (id, mission_id, label, kind, status, start_e, start_n, end_e,
                 end_n, length_m, label_num)
               VALUES ($1,$2,$3,$4,'Pending',$5,$6,$7,$8,$9,$10)`,
              [
                newId('l'),
                missionId,
                line.label,
                line.kind,
                line.start.easting,
                line.start.northing,
                line.end.easting,
                line.end.northing,
                line.length_m,
                line.label_num,
              ],
            );
          }
          await recordEvent(client, missionId, 'created', user.name, 'Mission created', ctx.now);
          return { status: 201, payload: await missionWithOwner(client, missionId, user, ctx.now) };
        }),
      );
      sendJson(ctx.res, result.status, result.payload);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      sendJson(ctx.res, 200, await missionWithOwner(pool, ctx.params.missionId!, user, ctx.now));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/lines',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      const state = await loadMissionState(pool, ctx.params.missionId!, ctx.now);
      if (!state) throw notFound();
      sendJson(ctx.res, 200, lineRecords(state));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/assignments',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      rolesOnly(user, ['principal_surveyor']);
      const entries = readAssignments(jsonObject(ctx));

      const lines = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();

        const allLines = await listLines(client, missionId);
        const byId = new Map(allLines.map((line) => [line.id, line]));
        const vessels = new Map((await listVessels(client)).map((vessel) => [vessel.id, vessel]));

        for (const entry of entries) {
          if (!byId.has(entry.line_id)) throw notFound();
          if (entry.vessel_id !== null && !vessels.has(entry.vessel_id)) throw notFound();
        }

        await lockVessels(
          client,
          entries.map((entry) => entry.vessel_id).filter((id): id is string => id !== null),
        );

        if (!missionAssignable(mission.status)) {
          throw conflict('mission_not_assignable', MISSION_NOT_ASSIGNABLE_COPY);
        }

        const refused = entries.find((entry) => !lineAssignable(byId.get(entry.line_id)!.status));
        if (refused) {
          const line = byId.get(refused.line_id)!;
          throw illegalTransition(
            line.status,
            refused.vessel_id === null ? 'Pending' : 'Assigned',
            REASSIGN_ONLY_COPY,
          );
        }

        for (const vesselId of new Set(
          entries.map((entry) => entry.vessel_id).filter((id): id is string => id !== null),
        )) {
          const other = await client.query<MissionRow>(
            `SELECT m.*, to_char(m.survey_date,'YYYY-MM-DD') AS survey_date FROM missions m
             WHERE m.id <> $2 AND m.status IN ('Planned','Launched','Surveying','Recovering')
               AND EXISTS (SELECT 1 FROM lines l WHERE l.mission_id = m.id AND l.vessel_id = $1)
             LIMIT 1`,
            [vesselId, missionId],
          );
          const winner = other.rows[0];
          if (winner) {
            throw conflict(
              'vessel_committed',
              vesselCommittedCopy(vessels.get(vesselId)!.name, winner.name),
            );
          }
        }

        const overdue = [...new Set(entries.map((entry) => entry.vessel_id))]
          .filter((id): id is string => id !== null)
          .map((id) => vessels.get(id)!)
          .filter((vessel) => isOverdue(vessel.hours_since_service, vessel.service_interval_h))
          .sort((a, b) => a.name.localeCompare(b.name, 'en'))[0];
        if (overdue) {
          throw conflict(
            'service_overdue',
            overdueBlockMessage(overdue.name, overdue.hours_since_service, overdue.service_interval_h),
          );
        }

        if (isMissionActive(mission.status)) {
          const ashore = [...new Set(entries.map((entry) => entry.vessel_id))]
            .filter((id): id is string => id !== null)
            .map((id) => vessels.get(id)!)
            .filter((vessel) => !vessel.afloat);
          if (ashore.length > 0) {
            throw conflict('vessels_not_afloat', notAfloatCopy(ashore.map((vessel) => vessel.name)));
          }
        }

        for (const entry of entries) {
          await client.query(
            `UPDATE lines SET vessel_id = $2, status = $3 WHERE id = $1`,
            [entry.line_id, entry.vessel_id, entry.vessel_id === null ? 'Pending' : 'Assigned'],
          );
        }
        await client.query('UPDATE missions SET version = version + 1 WHERE id = $1', [missionId]);
        await recordEvent(
          client,
          missionId,
          'assignments',
          user.name,
          `Assignments saved (${entries.length} lines)`,
          ctx.now,
        );
        return listLines(client, missionId);
      });

      const state = await loadMissionState(pool, missionId, ctx.now);
      const names = new Map((await listVessels(pool)).map((vessel) => [vessel.id, vessel.name]));
      sendJson(
        ctx.res,
        200,
        lines.map((line) =>
          toLine(
            line,
            line.vessel_id ? names.get(line.vessel_id) ?? null : null,
            state?.coverage.coveredByLine.get(line.id) ?? 0,
          ),
        ),
      );
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/transitions',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      await missionInScope(pool, user, missionId);
      staffOnly(user);
      const to = jsonObject(ctx).to;
      const words: MissionStatus[] = [
        'Launched',
        'Aborted',
        'Complete',
        'Surveying',
        'Recovering',
        'Planned',
      ];
      if (typeof to !== 'string' || !words.includes(to as MissionStatus)) {
        throw validation({ to: 'Send a mission status word' });
      }
      const target = to as MissionStatus;

      await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        const edge = missionEdgeRequestable(mission.status, target);
        if (!edge.ok) {
          throw illegalTransition(
            mission.status,
            target,
            illegalMoveCopy(mission.status, target),
          );
        }
        rolesOnly(user, [edge.role]);
        if (edge.role === 'principal_surveyor') await requireOwner(client, mission, user);

        const lines = await listLines(client, missionId);
        const vessels = new Map((await listVessels(client)).map((vessel) => [vessel.id, vessel]));
        await lockVessels(
          client,
          lines.map((line) => line.vessel_id).filter((id): id is string => id !== null),
        );

        if (target === 'Launched') {
          await refuseLaunch(lines, vessels);
        }
        if (target === 'Complete') {
          await refuseComplete(lines, vessels);
        }

        const moved = await setMissionStatus(
          client,
          missionId,
          mission.status,
          target,
          user.name,
          ctx.now,
          { launched: target === 'Launched', completed: target === 'Complete' },
        );
        if (!moved) {
          throw illegalTransition(
            mission.status,
            target,
            illegalMoveCopy(mission.status, target),
          );
        }
        if (target === 'Complete') {
          // Complete and report Pending commit together.
          await client.query(
            `UPDATE missions SET report_state = 'Pending', report_generated_at = $2,
               hold = NULL WHERE id = $1`,
            [missionId, ctx.now.toISOString()],
          );
          await clearMissionAlerts(client, missionId, ctx.now);
        }
        if (target === 'Aborted') {
          await client.query('UPDATE missions SET hold = NULL WHERE id = $1', [missionId]);
          await clearMissionAlerts(client, missionId, ctx.now);
        }
      });

      if (target === 'Complete') void writePendingReports().catch(() => undefined);
      sendJson(ctx.res, 200, await missionWithOwner(pool, missionId, user, ctx.now));
    },
  });
}

function readAssignments(body: Record<string, unknown>): { line_id: string; vessel_id: string | null }[] {
  const raw = body.assignments;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) {
    throw validation({ assignments: 'Send 1 to 500 assignments' });
  }
  return raw.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (typeof entry.line_id !== 'string') {
      throw validation({ assignments: 'Send 1 to 500 assignments' });
    }
    const vesselId = entry.vessel_id;
    if (vesselId !== null && typeof vesselId !== 'string') {
      throw validation({ assignments: 'Send 1 to 500 assignments' });
    }
    return { line_id: entry.line_id, vessel_id: vesselId ?? null };
  });
}

async function refuseLaunch(lines: LineRow[], vessels: Map<string, VesselRow>): Promise<void> {
  const planned = lines.filter((line) => line.kind !== 'infill');
  if (planned.some((line) => line.status !== 'Assigned')) {
    throw conflict('lines_unassigned', LINES_UNASSIGNED_COPY);
  }
  const assigned = [...new Set(planned.map((line) => line.vessel_id))]
    .filter((id): id is string => id !== null)
    .map((id) => vessels.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const overdue = assigned.find((vessel) =>
    isOverdue(vessel.hours_since_service, vessel.service_interval_h),
  );
  if (overdue) {
    throw conflict(
      'service_overdue',
      overdueBlockMessage(overdue.name, overdue.hours_since_service, overdue.service_interval_h),
    );
  }
  const ashore = assigned.filter((vessel) => !vessel.afloat);
  if (ashore.length > 0) {
    throw conflict('vessels_not_afloat', notAfloatCopy(ashore.map((vessel) => vessel.name)));
  }
}

async function refuseComplete(lines: LineRow[], vessels: Map<string, VesselRow>): Promise<void> {
  if (lines.some((line) => line.status !== 'Delivered' && line.status !== 'Superseded')) {
    throw conflict('lines_awaiting_upload', LINES_AWAITING_UPLOAD_COPY);
  }
  const afloat = [...new Set(lines.map((line) => line.vessel_id))]
    .filter((id): id is string => id !== null)
    .map((id) => vessels.get(id)!)
    .filter((vessel) => vessel.afloat);
  if (afloat.length > 0) {
    throw conflict('vessels_afloat', recoverEveryVesselCopy(afloat.map((vessel) => vessel.name)));
  }
}
