import type { GraphEdge, GraphNode, GraphResponse, StageHealthResponse } from '../../shared/types.js';
import { query } from '../db.js';
import { inSyncCounter } from '../domain/counter.js';
import { IDLE_RAIL, railPosition } from '../domain/rail.js';
import { stageStatus } from '../domain/stage-status.js';
import { caller, membership, requireRole, stageOf } from '../http/access.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import {
  PROMOTION_SELECT,
  activePromotionRow,
  buildPromotion,
  currentRevisionRow,
  healthRows,
  listStages,
  promotionCounter,
  shortDigest,
  type PromotionRow,
  type StageRow,
} from '../repo.js';
import { readStatus } from '../services/queues.js';
import { FieldErrors, readOverrides } from '../validate.js';

async function listProjects(ctx: Ctx): Promise<Reply> {
  const person = caller(ctx);
  const projects = await query<{ slug: string; name: string; role: string }>(
    `SELECT pr.slug, pr.name, m.role FROM memberships m
     JOIN projects pr ON pr.id = m.project_id
     WHERE m.person_id = $1 ORDER BY pr.name`,
    [person.id],
  );
  return { status: 200, json: { projects } };
}

/** The latest promotion into a stage, which is the one its incoming edge shows. */
async function latestPromotionRow(stageId: string): Promise<PromotionRow | null> {
  const rows = await query<PromotionRow>(
    `${PROMOTION_SELECT} WHERE p.stage_id = $1 ORDER BY p.requested_at DESC, p.seq DESC LIMIT 1`,
    [stageId],
  );
  return rows[0] ?? null;
}

async function nodeFor(stage: StageRow): Promise<{ node: GraphNode; edge: GraphEdge }> {
  const active = await activePromotionRow(stage.id);
  const current = await currentRevisionRow(stage.id);
  const latest = await latestPromotionRow(stage.id);

  const counter = current ? inSyncCounter(await healthRows(current.id)) : null;
  const node: GraphNode = {
    stage: stage.name,
    cluster: stage.cluster_name,
    time_zone: stage.time_zone,
    upstream: stage.upstream_name,
    requires_approval: stage.requires_approval,
    defaults: stage.defaults,
    status: stageStatus(active?.state ?? null, current?.state ?? null),
    current: current
      ? {
          promotion_id: current.id,
          version: current.bundle_version,
          short_digest: shortDigest(current.bundle_digest),
        }
      : null,
    counter,
    active_promotion: active ? await buildPromotion(active) : null,
  };

  const rail = latest
    ? railPosition(latest.state, await promotionCounter(latest), latest.degraded_progress)
    : IDLE_RAIL;
  const edge: GraphEdge = {
    from: stage.upstream_name ?? 'bundles',
    to: stage.name,
    phase: rail.phase,
    progress: rail.progress,
    promotion_id: latest?.id ?? null,
  };
  return { node, edge };
}

async function readGraph(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const stages = await listStages(project.id);
  const assembled = await Promise.all(stages.map((stage) => nodeFor(stage)));
  const graph: GraphResponse = {
    project: { slug: project.slug, name: project.name },
    role,
    nodes: assembled.map((entry) => entry.node),
    edges: assembled.map((entry) => entry.edge),
  };
  return { status: 200, json: graph };
}

async function readInstallationStatus(ctx: Ctx): Promise<Reply> {
  caller(ctx);
  return { status: 200, json: await readStatus() };
}

async function readStageHealth(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const stage = await stageOf(ctx, project.id);
  const current = await currentRevisionRow(stage.id);
  if (!current) {
    const empty: StageHealthResponse = { revision: null, in_sync: 0, total: 0, resources: [] };
    return { status: 200, json: empty };
  }
  const resources = await healthRows(current.id);
  const counter = inSyncCounter(resources);
  const health: StageHealthResponse = {
    revision: current.id,
    in_sync: counter.in_sync,
    total: counter.total,
    resources,
  };
  return { status: 200, json: health };
}

async function editStageDefaults(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const stage = await stageOf(ctx, project.id);
  requireRole(role, 'edit_stage_defaults');
  const fields = new FieldErrors();
  const defaults = readOverrides(ctx.body.defaults, fields);
  fields.throwIfAny();
  await query('UPDATE stages SET defaults = $2 WHERE id = $1', [stage.id, defaults]);
  return { status: 200, json: { stage: stage.name, defaults } };
}

export const projectRoutes: Route[] = [
  { method: 'GET', template: '/api/projects', access: 'session', handler: listProjects },
  { method: 'GET', template: '/api/projects/:project/graph', access: 'session', handler: readGraph },
  { method: 'GET', template: '/api/status', access: 'session', handler: readInstallationStatus },
  {
    method: 'GET',
    template: '/api/projects/:project/stages/:stage/health',
    access: 'session',
    handler: readStageHealth,
  },
  {
    method: 'PATCH',
    template: '/api/projects/:project/stages/:stage',
    access: 'session',
    handler: editStageDefaults,
  },
];
