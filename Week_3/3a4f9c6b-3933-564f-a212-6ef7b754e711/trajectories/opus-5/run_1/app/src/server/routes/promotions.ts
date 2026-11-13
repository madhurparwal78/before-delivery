import type { Overrides, ProjectRole } from '../../shared/types.js';
import { query } from '../db.js';
import type { Action } from '../../shared/authority.js';
import { mayPerform } from '../../shared/authority.js';
import { errors, fieldMessages } from '../errors.js';
import { caller, membership, requireRole, stageOf } from '../http/access.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import {
  approvePromotion,
  breakFreeze,
  rejectPromotion,
  requestPromotion,
  retryWindow,
  rollbackStage,
  startPromotion,
} from '../promotions.js';
import {
  PROMOTION_SELECT,
  buildPromotion,
  buildPromotions,
  findBundleByVersion,
  findMembership,
  type BundleRow,
  type PromotionRow,
} from '../repo.js';
import { latestStoredSnapshot } from '../services/queues.js';
import { StorageUnreachable, getObject } from '../services/storage.js';
import {
  FieldErrors,
  readComment,
  readParameters,
  readReason,
  readReplicas,
  readWholeNumber,
} from '../validate.js';

const SCALABLE_KINDS = new Set(['Deployment', 'StatefulSet']);

function readRequestedOverrides(value: unknown, bundle: BundleRow): Overrides {
  const fields = new FieldErrors();
  const source =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const parameters = readParameters(source.parameters, fields, 'parameters');
  const replicas = readReplicas(source.replicas, fields, 'replicas');
  const scalable = new Set(
    bundle.resources.filter((resource) => SCALABLE_KINDS.has(resource.kind)).map((resource) => resource.ref),
  );
  for (const ref of Object.keys(replicas)) {
    if (!scalable.has(ref)) fields.add('replicas', fieldMessages.replicaRefs);
  }
  fields.throwIfAny();
  return { parameters, replicas };
}

async function createPromotion(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const stage = await stageOf(ctx, project.id);
  requireRole(role, 'request_promotion');
  const person = caller(ctx);

  const version = typeof ctx.body.bundle_version === 'string' ? ctx.body.bundle_version : '';
  const bundle = await findBundleByVersion(project.id, version);
  if (!bundle) throw errors.validation({ bundle_version: fieldMessages.unknownBundleVersion });

  const overrides = readRequestedOverrides(ctx.body.overrides, bundle);
  const promotion = await requestPromotion({ project, stage, bundle, overrides, requester: person });
  return { status: 201, json: promotion };
}

async function listPromotions(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const limitParam = ctx.query.get('limit');
  const limit = limitParam === null ? 50 : readWholeNumber(limitParam, 1, 100);
  if (limit === null) throw errors.validation({ limit: fieldMessages.limit });

  const stageName = ctx.query.get('stage');
  const rows = await query<PromotionRow>(
    `${PROMOTION_SELECT}
     WHERE p.project_id = $1 AND ($2::text IS NULL OR s.name = $2)
     ORDER BY p.requested_at DESC, p.seq DESC LIMIT $3`,
    [project.id, stageName, limit],
  );
  const promotions = await buildPromotions(rows);
  return { status: 200, json: { promotions } };
}

/** A promotion in a project the caller does not belong to answers as unknown. */
async function promotionFor(
  ctx: Ctx,
  action?: Action,
): Promise<{ row: PromotionRow; role: ProjectRole }> {
  const person = caller(ctx);
  const id = ctx.params.id ?? '';
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw errors.notFound();
  const row = await query<PromotionRow>(`${PROMOTION_SELECT} WHERE p.id = $1`, [id]);
  const found = row[0];
  if (!found) throw errors.notFound();
  const role = await findMembership(found.project_id, person.id);
  if (!role) throw errors.notFound();
  if (action && !mayPerform(role, action)) throw errors.forbidden();
  return { row: found, role };
}

async function readPromotion(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx);
  return { status: 200, json: await buildPromotion(row) };
}

async function approve(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx, 'approve');
  const comment = readComment(ctx.body);
  return { status: 200, json: await approvePromotion(row, caller(ctx), comment) };
}

async function reject(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx, 'reject');
  const reason = readReason(ctx.body);
  return { status: 200, json: await rejectPromotion(row, caller(ctx), reason) };
}

async function start(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx, 'start_promotion');
  return { status: 200, json: await startPromotion(row, caller(ctx)) };
}

async function recheckWindow(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx, 'retry_window');
  return { status: 200, json: await retryWindow(row, caller(ctx)) };
}

async function freezeBreak(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx, 'break_freeze');
  const reason = readReason(ctx.body);
  return { status: 200, json: await breakFreeze(row, caller(ctx), reason) };
}

async function rollback(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  const stage = await stageOf(ctx, project.id);
  requireRole(role, 'rollback');
  readReason(ctx.body);
  const promotion = await rollbackStage({ project, stage, actor: caller(ctx) });
  return { status: 201, json: promotion };
}

async function downloadEvidence(ctx: Ctx): Promise<Reply> {
  const { row } = await promotionFor(ctx);
  const snapshot = await latestStoredSnapshot(row.id);
  if (!snapshot) throw errors.evidencePending();

  let bytes: Buffer | null;
  try {
    bytes = await getObject(snapshot.object_key);
  } catch (cause) {
    if (cause instanceof StorageUnreachable) throw errors.storageUnavailable();
    throw cause;
  }
  if (!bytes) throw errors.storageUnavailable();

  return {
    status: 200,
    raw: bytes,
    headers: {
      'content-type': 'application/json',
      'content-disposition':
        `attachment; filename="keelson-evidence-${row.id}-${snapshot.snapshot_number}.json"`,
    },
  };
}

function onStage(action: Action): (ctx: Ctx) => Promise<void> {
  return async (ctx) => {
    const { project, role } = await membership(ctx);
    await stageOf(ctx, project.id);
    requireRole(role, action);
  };
}

function onPromotion(action: Action): (ctx: Ctx) => Promise<void> {
  return async (ctx) => {
    await promotionFor(ctx, action);
  };
}

export const promotionRoutes: Route[] = [
  {
    method: 'POST',
    template: '/api/projects/:project/stages/:stage/promotions',
    access: 'session',
    authorize: onStage('request_promotion'),
    handler: createPromotion,
  },
  { method: 'GET', template: '/api/projects/:project/promotions', access: 'session', handler: listPromotions },
  { method: 'GET', template: '/api/promotions/:id', access: 'session', handler: readPromotion },
  {
    method: 'POST',
    template: '/api/promotions/:id/approve',
    access: 'session',
    authorize: onPromotion('approve'),
    handler: approve,
  },
  {
    method: 'POST',
    template: '/api/promotions/:id/reject',
    access: 'session',
    authorize: onPromotion('reject'),
    handler: reject,
  },
  {
    method: 'POST',
    template: '/api/promotions/:id/start',
    access: 'session',
    authorize: onPromotion('start_promotion'),
    handler: start,
  },
  {
    method: 'POST',
    template: '/api/promotions/:id/retry-window',
    access: 'session',
    authorize: onPromotion('retry_window'),
    handler: recheckWindow,
  },
  {
    method: 'POST',
    template: '/api/promotions/:id/break-freeze',
    access: 'session',
    authorize: onPromotion('break_freeze'),
    handler: freezeBreak,
  },
  {
    method: 'POST',
    template: '/api/projects/:project/stages/:stage/rollback',
    access: 'session',
    authorize: onStage('rollback'),
    handler: rollback,
  },
  { method: 'GET', template: '/api/promotions/:id/evidence', access: 'session', handler: downloadEvidence },
];
