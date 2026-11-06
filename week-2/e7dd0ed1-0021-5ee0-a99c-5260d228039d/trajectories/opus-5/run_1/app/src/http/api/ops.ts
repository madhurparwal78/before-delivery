import { query, rows, transaction } from '../../db';
import { limits } from '../../config';
import { apiError, validation } from '../../errors';
import { isoSecond } from '../../format';
import { onlyFields, readJsonBody, requireXRequestedWith, sendJson, type Context } from '../core';
import { resolveCaller, type Principal } from '../../domain/auth';
import { appendAudit } from '../../domain/audit';
import { countCharacters } from '../../domain/text';
import { requeueRegion } from '../../domain/replicas';
import { runLifecycleSweep } from '../../domain/lifecycle';
import { syncBilling } from '../../workers/billing';
import { mailSuspended } from '../../domain/notifications';
import { billingStatusRow } from '../../domain/usage';
import type { Router } from '../router';

/** Every /api/ops path is decided right after authentication, before any lookup. */
export async function operatorGate(ctx: Context): Promise<Principal> {
  requireXRequestedWith(ctx);
  const caller = await resolveCaller(ctx);
  if (caller.kind === 'anonymous') throw apiError('unauthenticated');
  if (caller.kind === 'pending') throw apiError('two_step_required');
  if (caller.principal.user.is_operator !== true) {
    throw apiError('forbidden', 'This area is for the Farshore operator.');
  }
  return caller.principal;
}

async function regionRows(): Promise<Record<string, unknown>[]> {
  const found = await query<{
    id: string;
    name: string;
    state: string;
    pending: string;
    failed: string;
    oldest: string | null;
  }>(
    `select g.id, g.name, g.state,
            (select count(*) from replicas r join object_versions v on v.version_id = r.version_id
              where r.region = g.id and v.is_current and r.state = 'pending')::text as pending,
            (select count(*) from replicas r join object_versions v on v.version_id = r.version_id
              where r.region = g.id and v.is_current and r.state = 'failed')::text as failed,
            (select min(v.acknowledged_at) from replicas r join object_versions v on v.version_id = r.version_id
              where r.region = g.id and v.is_current and r.state = 'pending') as oldest
     from regions g order by g.id`,
  );
  return found.map((region) => ({
    id: region.id,
    name: region.name,
    state: region.state,
    pending: Number(region.pending),
    failed: Number(region.failed),
    oldest_pending_ms: region.oldest === null ? null : Math.max(0, Date.now() - new Date(region.oldest).getTime()),
  }));
}

export function registerOpsRoutes(router: Router): void {
  router.get('/api/ops/regions', async (ctx) => {
    sendJson(ctx, 200, { regions: await regionRows() });
  });

  router.post('/api/ops/regions/:id/state', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['state']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    if (body.state !== 'online' && body.state !== 'offline') throw validation({ state: 'Choose online or offline.' });
    const next = body.state;
    await transaction(async (client) => {
      const region = await rows<{ id: string; state: string }>(client, 'select id, state from regions where id = $1 for update', [
        ctx.params.id,
      ]);
      if (region.length === 0) throw apiError('not_found');
      if (region[0].state === next) {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
          from: region[0].state,
          to: next,
        });
      }
      await client.query('update regions set state = $2 where id = $1', [ctx.params.id, next]);
      if (next === 'online') await requeueRegion(client, ctx.params.id);
    });
    const regions = await regionRows();
    sendJson(ctx, 200, regions.find((region) => region.id === ctx.params.id) ?? {});
  });

  router.get('/api/ops/workspaces', async (ctx) => {
    const found = await query<{
      slug: string;
      name: string;
      plan_id: string;
      status: string;
      suspended_reason: string | null;
      members: string;
      buckets: string;
    }>(
      `select w.slug, w.name, w.plan_id, w.status, w.suspended_reason,
              (select count(*) from memberships m where m.workspace_slug = w.slug)::text as members,
              (select count(*) from buckets b where b.workspace_slug = w.slug)::text as buckets
       from workspaces w order by w.name`,
    );
    sendJson(ctx, 200, {
      workspaces: found.map((workspace) => ({
        slug: workspace.slug,
        name: workspace.name,
        plan: workspace.plan_id,
        members: Number(workspace.members),
        buckets: Number(workspace.buckets),
        status: workspace.status,
        suspended_reason: workspace.suspended_reason,
      })),
    });
  });

  router.post('/api/ops/workspaces/:ws/suspend', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['reason']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    if (typeof body.reason !== 'string' || countCharacters(body.reason) < 1 || countCharacters(body.reason) > 280) {
      throw validation({ reason: 'Give a reason of 1 to 280 characters.' });
    }
    const reason = body.reason;
    const updated = await transaction(async (client) => {
      const workspace = await rows<{ slug: string; name: string; status: string }>(
        client,
        'select slug, name, status from workspaces where slug = $1 for update',
        [ctx.params.ws],
      );
      if (workspace.length === 0) throw apiError('not_found');
      if (workspace[0].status === 'suspended') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
          from: 'suspended',
          to: 'suspended',
        });
      }
      await client.query("update workspaces set status = 'suspended', suspended_reason = $2 where slug = $1", [
        ctx.params.ws,
        reason,
      ]);
      await appendAudit(client, ctx.params.ws, {
        actor: 'operator',
        action: 'workspace.suspended',
        target: ctx.params.ws,
        detail: reason,
      });
      await mailSuspended(client, ctx.params.ws, { workspaceName: workspace[0].name, reason });
      return workspace[0];
    });
    sendJson(ctx, 200, await workspaceJson(updated.slug));
  });

  router.post('/api/ops/workspaces/:ws/reinstate', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, []);
    if (Object.keys(extra).length > 0) throw validation(extra);
    await transaction(async (client) => {
      const workspace = await rows<{ slug: string; status: string }>(
        client,
        'select slug, status from workspaces where slug = $1 for update',
        [ctx.params.ws],
      );
      if (workspace.length === 0) throw apiError('not_found');
      if (workspace[0].status === 'active') {
        throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
          from: 'active',
          to: 'active',
        });
      }
      await client.query("update workspaces set status = 'active', suspended_reason = null where slug = $1", [ctx.params.ws]);
      await appendAudit(client, ctx.params.ws, {
        actor: 'operator',
        action: 'workspace.reinstated',
        target: ctx.params.ws,
        detail: '',
      });
    });
    sendJson(ctx, 200, await workspaceJson(ctx.params.ws));
  });

  router.post('/api/ops/lifecycle/run', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, []);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const result = await runLifecycleSweep();
    sendJson(ctx, 200, {
      expired_versions: result.expiredVersions,
      aborted_uploads: result.abortedUploads,
      skipped_locked: result.skippedLocked,
    });
  });

  router.get('/api/ops/billing', async (ctx) => {
    const status = await billingStatusRow();
    const counts = await query<{ queued: string; posted: string }>(
      `select count(*) filter (where billing_state <> 'posted' and sealed)::text as queued,
              count(*) filter (where billing_state = 'posted')::text as posted from usage_rows`,
    );
    const queued = Number(counts[0]?.queued ?? '0');
    sendJson(ctx, 200, {
      state: !status.reachable ? 'delayed' : queued > 0 ? 'pending' : 'in_sync',
      queued_rows: queued,
      posted_rows: Number(counts[0]?.posted ?? '0'),
      last_attempt_at: status.last_attempt_at ? isoSecond(status.last_attempt_at) : null,
      last_error: status.last_error,
    });
  });

  router.post('/api/ops/billing/sync', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, []);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const result = await syncBilling(true);
    sendJson(ctx, result.queued === 0 ? 200 : 202, {
      sealed: result.sealed,
      posted: result.posted,
      queued: result.queued,
      state: result.state,
    });
  });
}

async function workspaceJson(slug: string): Promise<Record<string, unknown>> {
  const found = await query<{
    slug: string;
    name: string;
    plan_id: string;
    status: string;
    suspended_reason: string | null;
    members: string;
    buckets: string;
  }>(
    `select w.slug, w.name, w.plan_id, w.status, w.suspended_reason,
            (select count(*) from memberships m where m.workspace_slug = w.slug)::text as members,
            (select count(*) from buckets b where b.workspace_slug = w.slug)::text as buckets
     from workspaces w where w.slug = $1`,
    [slug],
  );
  const workspace = found[0];
  return {
    slug: workspace.slug,
    name: workspace.name,
    plan: workspace.plan_id,
    members: Number(workspace.members),
    buckets: Number(workspace.buckets),
    status: workspace.status,
    suspended_reason: workspace.suspended_reason,
  };
}
