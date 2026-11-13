import type { ApprovalLinkResponse, ResourceHealth, ResourceSync } from '../../shared/types.js';
import { queryOne } from '../db.js';
import { errors, fieldMessages } from '../errors.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import { applyAgentReport, hashToken } from '../promotions.js';
import { PROMOTION_SELECT, findStageById, shortDigest, type PromotionRow } from '../repo.js';
import { FieldErrors, asObject } from '../validate.js';

const SYNC_VALUES: ResourceSync[] = ['Synced', 'OutOfSync'];
const HEALTH_VALUES: ResourceHealth[] = ['Healthy', 'Progressing', 'Degraded', 'Missing'];

async function postReport(ctx: Ctx): Promise<Reply> {
  const cluster = ctx.cluster;
  if (!cluster) throw errors.unauthenticated();

  const promotionId = typeof ctx.body.promotion_id === 'string' ? ctx.body.promotion_id : '';
  if (!/^[0-9a-fA-F-]{36}$/.test(promotionId)) throw errors.notFound();
  const row = await queryOne<PromotionRow>(`${PROMOTION_SELECT} WHERE p.id = $1`, [promotionId]);
  if (!row) throw errors.notFound();
  const stage = await findStageById(row.stage_id);
  if (!stage || stage.cluster_id !== cluster.id) throw errors.notFound();

  const fields = new FieldErrors();
  const phase = ctx.body.phase;
  if (phase !== 'applying' && phase !== 'health_wait') fields.add('phase', fieldMessages.agentPhase);
  const raw = ctx.body.resources;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 200) {
    fields.add('resources', fieldMessages.agentResources);
  }
  fields.throwIfAny();

  const resources = (raw as unknown[]).map((entry) => {
    const item = asObject(entry);
    const ref = typeof item.ref === 'string' ? item.ref : '';
    if (
      ref === '' ||
      !SYNC_VALUES.includes(item.sync as ResourceSync) ||
      !HEALTH_VALUES.includes(item.health as ResourceHealth)
    ) {
      throw errors.validation({ resources: fieldMessages.agentResources });
    }
    return { ref, sync: item.sync as ResourceSync, health: item.health as ResourceHealth };
  });

  const result = await applyAgentReport({
    promotionId,
    phase: phase as 'applying' | 'health_wait',
    resources,
  });
  return { status: 200, json: result };
}

/** The approval link works without a session until the request is decided or expires. */
async function readApprovalLink(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token ?? '';
  const link = await queryOne<{ promotion_id: string }>(
    'SELECT promotion_id FROM approval_links WHERE token_hash = $1',
    [hashToken(token)],
  );
  if (!link) throw errors.notFound();
  const row = await queryOne<PromotionRow>(`${PROMOTION_SELECT} WHERE p.id = $1`, [link.promotion_id]);
  if (!row) throw errors.notFound();
  if (row.state !== 'awaiting_approval') throw errors.linkExpired();

  const response: ApprovalLinkResponse = {
    project: row.project_slug,
    stage: row.stage_name,
    bundle: { version: row.bundle_version, short_digest: shortDigest(row.bundle_digest) },
    requested_by: row.requester_email,
    request_expires_at: (row.request_expires_at ?? row.requested_at).toISOString(),
    time_zone: row.time_zone,
    diff: row.diff,
    promotion_id: row.id,
  };
  return { status: 200, json: response };
}

export const agentRoutes: Route[] = [
  { method: 'POST', template: '/api/agent/reports', access: 'agent', handler: postReport },
  { method: 'GET', template: '/api/approval-links/:token', access: 'public', handler: readApprovalLink },
];
