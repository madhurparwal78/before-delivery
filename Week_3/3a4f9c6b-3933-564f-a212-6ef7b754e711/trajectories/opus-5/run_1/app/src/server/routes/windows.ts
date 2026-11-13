import { randomUUID } from 'node:crypto';
import type { ClusterView, Freeze, FreezePolicyResponse } from '../../shared/types.js';
import { query } from '../db.js';
import { latestVersion, versionInForce } from '../domain/freeze-policy.js';
import { decideWindow, nextOpenings } from '../domain/window-check.js';
import { errors, fieldMessages } from '../errors.js';
import { membership, requireRole, stageOf } from '../http/access.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import {
  findCluster,
  listClusters,
  listFreezeVersions,
  listStages,
  listWindows,
  type ClusterRow,
} from '../repo.js';
import {
  FieldErrors,
  asObject,
  readInstant,
  readWeekDays,
  readWholeNumber,
  readWindowTime,
} from '../validate.js';
import { hhMmFromMinutes } from '../../shared/zone.js';

async function clusterOf(ctx: Ctx, projectId: string): Promise<ClusterRow> {
  const cluster = await findCluster(projectId, ctx.params.cluster ?? '');
  if (!cluster) throw errors.notFound();
  return cluster;
}

async function readClusters(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const stages = await listStages(project.id);
  const clusters: ClusterView[] = [];
  for (const cluster of await listClusters(project.id)) {
    clusters.push({
      name: cluster.name,
      time_zone: cluster.time_zone,
      stages: stages.filter((stage) => stage.cluster_id === cluster.id).map((stage) => stage.name),
      windows: await listWindows(cluster.id),
    });
  }
  return { status: 200, json: { clusters } };
}

async function addWindow(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const cluster = await clusterOf(ctx, project.id);
  requireRole(role, 'manage_windows');

  const fields = new FieldErrors();
  const label = typeof ctx.body.label === 'string' ? ctx.body.label.trim() : '';
  if (label.length < 1 || label.length > 80) fields.add('label', fieldMessages.label);
  const days = readWeekDays(ctx.body.days, fields);
  const start = readWindowTime(ctx.body.start, 'start', fields);
  const end = readWindowTime(ctx.body.end, 'end', fields);
  if (start !== null && end !== null && end <= start) fields.add('end', fieldMessages.endAfterStart);
  fields.throwIfAny();

  const id = randomUUID();
  await query(
    `INSERT INTO sync_windows (id, cluster_id, label, days, start_minutes, end_minutes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, cluster.id, label, days, start as number, end as number],
  );
  return {
    status: 201,
    json: {
      id,
      label,
      days,
      start: hhMmFromMinutes(start as number),
      end: hhMmFromMinutes(end as number),
    },
  };
}

async function deleteWindow(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const cluster = await clusterOf(ctx, project.id);
  requireRole(role, 'manage_windows');
  const removed = await query<{ id: string }>(
    'DELETE FROM sync_windows WHERE id = $1 AND cluster_id = $2 RETURNING id',
    [ctx.params.id ?? '', cluster.id],
  );
  if (removed.length === 0) throw errors.notFound();
  return { status: 204 };
}

async function readOpenings(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const cluster = await clusterOf(ctx, project.id);

  const fromParam = ctx.query.get('from');
  const from = fromParam === null ? new Date() : readInstant(fromParam);
  if (from === null) throw errors.validation({ from: fieldMessages.from });
  const countParam = ctx.query.get('count');
  const count = countParam === null ? 5 : readWholeNumber(countParam, 1, 20);
  if (count === null) throw errors.validation({ count: fieldMessages.count });

  const windows = await listWindows(cluster.id);
  return {
    status: 200,
    json: { time_zone: cluster.time_zone, openings: nextOpenings(windows, cluster.time_zone, from, count) },
  };
}

async function readWindowDecision(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const stage = await stageOf(ctx, project.id);

  const atParam = ctx.query.get('at');
  const at = atParam === null ? new Date() : readInstant(atParam);
  if (at === null) throw errors.validation({ at: fieldMessages.from });

  const policy = versionInForce(await listFreezeVersions(project.id), at);
  const decision = decideWindow({
    instant: at,
    timeZone: stage.time_zone,
    stage: stage.name,
    windows: await listWindows(stage.cluster_id),
    freezes: policy.freezes,
    policyVersion: policy.version,
  });
  return { status: 200, json: decision };
}

async function readFreezePolicy(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const versions = await listFreezeVersions(project.id);
  const response: FreezePolicyResponse = {
    in_force_version: versionInForce(versions, new Date()).version,
    versions,
  };
  return { status: 200, json: response };
}

function readFreezes(value: unknown, stageNames: string[], fields: FieldErrors): Freeze[] {
  if (!Array.isArray(value)) {
    fields.add('freezes', fieldMessages.freezeOrder);
    return [];
  }
  const freezes: Freeze[] = [];
  for (const raw of value) {
    const entry = asObject(raw);
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name.length < 1 || name.length > 80) {
      fields.add('freezes', fieldMessages.label);
      return [];
    }
    const starts = readInstant(entry.starts_at);
    const ends = readInstant(entry.ends_at);
    if (!starts || !ends || ends.getTime() <= starts.getTime()) {
      fields.add('freezes', fieldMessages.freezeOrder);
      return [];
    }
    const stages = Array.isArray(entry.stages) ? entry.stages : [];
    for (const stage of stages) {
      if (typeof stage !== 'string' || !stageNames.includes(stage)) {
        fields.add('freezes', fieldMessages.unknownStage(String(stage)));
        return [];
      }
    }
    freezes.push({
      name,
      stages: stages as string[],
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
    });
  }
  return freezes;
}

/**
 * A new version replaces the whole set of freezes and must name the latest version it was based
 * on, so a freeze edit built on a stale view is refused rather than silently lost.
 */
async function scheduleFreezeVersion(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  requireRole(role, 'schedule_freeze_version');
  const versions = await listFreezeVersions(project.id);
  const latest = latestVersion(versions);

  const basedOn = ctx.body.based_on_version;
  if (basedOn !== latest.version) throw errors.staleVersion(latest.version);

  const fields = new FieldErrors();
  const effectiveFrom = readInstant(ctx.body.effective_from);
  if (!effectiveFrom) {
    fields.add('effective_from', fieldMessages.from);
  } else if (effectiveFrom.getTime() < Date.now()) {
    fields.add('effective_from', fieldMessages.effectiveFromPast);
  } else if (effectiveFrom.getTime() <= Date.parse(latest.effective_from)) {
    fields.add('effective_from', fieldMessages.effectiveFromOrder(latest.version));
  }
  const stageNames = (await listStages(project.id)).map((stage) => stage.name);
  const freezes = readFreezes(ctx.body.freezes, stageNames, fields);
  fields.throwIfAny();

  const version = latest.version + 1;
  const person = ctx.person;
  if (!person) throw errors.unauthenticated();
  await query(
    `INSERT INTO freeze_policy_versions
       (id, project_id, version, effective_from, created_by, created_at, freezes)
     VALUES ($1, $2, $3, $4, $5, now(), $6)`,
    [randomUUID(), project.id, version, effectiveFrom as Date, person.email, JSON.stringify(freezes)],
  );
  const stored = await listFreezeVersions(project.id);
  const created = stored.find((candidate) => candidate.version === version);
  return { status: 201, json: created };
}

export const windowRoutes: Route[] = [
  { method: 'GET', template: '/api/projects/:project/clusters', access: 'session', handler: readClusters },
  {
    method: 'POST',
    template: '/api/projects/:project/clusters/:cluster/windows',
    access: 'session',
    handler: addWindow,
  },
  {
    method: 'DELETE',
    template: '/api/projects/:project/clusters/:cluster/windows/:id',
    access: 'session',
    handler: deleteWindow,
  },
  {
    method: 'GET',
    template: '/api/projects/:project/clusters/:cluster/window-openings',
    access: 'session',
    handler: readOpenings,
  },
  {
    method: 'GET',
    template: '/api/projects/:project/stages/:stage/window-decision',
    access: 'session',
    handler: readWindowDecision,
  },
  {
    method: 'GET',
    template: '/api/projects/:project/freeze-policy',
    access: 'session',
    handler: readFreezePolicy,
  },
  {
    method: 'POST',
    template: '/api/projects/:project/freeze-policy/versions',
    access: 'session',
    handler: scheduleFreezeVersion,
  },
];
