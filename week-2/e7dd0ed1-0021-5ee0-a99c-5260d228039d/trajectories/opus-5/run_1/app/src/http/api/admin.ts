import { query, rows, transaction } from '../../db';
import { limits } from '../../config';
import { apiError, validation } from '../../errors';
import { isoSecond, roundPercent } from '../../format';
import { unwrapDataKey, wrapDataKey } from '../../crypto/seal';
import { csvLine } from '../../domain/text';
import { header, onlyFields, readJsonBody, requireXRequestedWith, sendJson, sendNoContent, sendText, type Context } from '../core';
import { requireCapability, requireStepUp, requireWorkspace, resolveCaller, type WorkspaceScope } from '../../domain/auth';
import { appendAudit, auditActions, verifyChain } from '../../domain/audit';
import { listBuckets } from '../../domain/buckets';
import { currentVersion, versionById } from '../../domain/versions';
import { createLink, findLinkById, linkJson, listLinks, revokeLink, revokeLinksByCreator, validateExpiry } from '../../domain/links';
import {
  changeRole,
  checkInviteRate,
  createInvite,
  emailMessage,
  inviteJson,
  isValidEmail,
  listInvites,
  listMembers,
  removeMember,
  roleMessage,
} from '../../domain/members';
import {
  createKey,
  deleteKey,
  disableKey,
  findKeyIn,
  keyJson,
  listKeys,
  rotateKey,
  validateKeyInput,
} from '../../domain/keys';
import {
  createEndpoint,
  deleteEndpoint,
  deliveryJson,
  endpointJson,
  findEndpoint,
  listDeliveries,
  listEndpoints,
  redeliver,
  setEndpointState,
  validateEndpoint,
} from '../../domain/webhooks';
import { mailInvite, mailKeyCreated, mailKeyRotated } from '../../domain/notifications';
import { billingSummary, currentPeriod, monthToDate, usageRowsForPeriod, usageRowsPage } from '../../domain/usage';
import { quotaBytesForPlan } from '../../domain/quota';
import { planById } from '../../domain/seeddata';
import type { Router } from '../router';

async function ownerScope(ctx: Context): Promise<WorkspaceScope> {
  const scope = await requireWorkspace(await resolveCaller(ctx), ctx.params.ws);
  await requireCapability(scope, 'admin', ctx, ctx.path);
  return scope;
}

function originOf(ctx: Context): string {
  const host = header(ctx, 'host') ?? 'localhost';
  const proto = header(ctx, 'x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export function registerAdminRoutes(router: Router): void {
  router.post('/api/w/:ws/buckets/:bucket/object/links', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await requireWorkspace(await resolveCaller(ctx), ctx.params.ws);
    const key = ctx.query.get('key');
    if (key === null) throw validation({ key: 'This field is required.' });
    await requireCapability(scope, 'mint_link', ctx, key);
    if (scope.workspace.status === 'suspended') throw apiError('workspace_suspended', 'This workspace is suspended.');
    const buckets = await listBuckets(scope.workspace.slug);
    const bucket = buckets.find((item) => item.name === ctx.params.bucket);
    if (!bucket) throw apiError('not_found');
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['expires_in_seconds']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const seconds = validateExpiry(body.expires_in_seconds);
    const versionId = ctx.query.get('version');
    const version = versionId ? await versionById(bucket.name, versionId) : await currentVersion(bucket.name, key);
    if (!version || version.object_key !== key) throw apiError('not_found');
    const created = await transaction(async (client) =>
      createLink(client, {
        slug: scope.workspace.slug,
        bucket: bucket.name,
        key,
        versionId: version.version_id,
        createdBy: scope.principal.user.id,
        expiresInSeconds: seconds,
      }),
    );
    sendJson(ctx, 201, {
      id: created.link.id,
      url: `${originOf(ctx)}/l/${created.token}`,
      bucket: bucket.name,
      key,
      version_id: version.version_id,
      expires_at: isoSecond(created.link.expires_at),
      state: 'active',
    });
  });

  router.get('/api/w/:ws/links', async (ctx) => {
    const scope = await requireWorkspace(await resolveCaller(ctx), ctx.params.ws);
    const links = await listLinks(scope.workspace.slug);
    sendJson(ctx, 200, { links: links.map((link) => linkJson(link)) });
  });

  router.post('/api/w/:ws/links/:id/revoke', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await requireWorkspace(await resolveCaller(ctx), ctx.params.ws);
    const updated = await transaction(async (client) => {
      const link = await findLinkById(client, scope.workspace.slug, ctx.params.id);
      if (!link) throw apiError('not_found');
      const own = link.created_by === scope.principal.user.id;
      if (!own && scope.role === 'viewer') {
        await appendAudit(client, scope.workspace.slug, {
          actor: scope.principal.user.email,
          action: 'permission.denied',
          target: link.object_key,
          detail: `${ctx.method} ${ctx.path}`,
        });
        throw apiError('forbidden', "You can't do that.");
      }
      return revokeLink(client, link);
    });
    sendJson(ctx, 200, linkJson(updated));
  });

  router.get('/api/w/:ws/members', async (ctx) => {
    const scope = await ownerScope(ctx);
    sendJson(ctx, 200, { members: await listMembers(scope.workspace.slug) });
  });

  router.patch('/api/w/:ws/members/:user_id', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['role']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    if (body.role !== 'owner' && body.role !== 'developer' && body.role !== 'viewer') {
      throw validation({ role: 'Choose owner, developer or viewer.' });
    }
    const changed = await transaction(async (client) => {
      const result = await changeRole(client, scope.workspace.slug, ctx.params.user_id, body.role as 'owner' | 'developer' | 'viewer');
      if (result.previous !== body.role) {
        await appendAudit(client, scope.workspace.slug, {
          actor: scope.principal.user.email,
          action: 'member.role_changed',
          target: result.member.email,
          detail: `${result.previous} -> ${body.role as string}`,
        });
      }
      return result.member;
    });
    sendJson(ctx, 200, changed);
  });

  router.delete('/api/w/:ws/members/:user_id', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    await transaction(async (client) => {
      const member = await removeMember(client, scope.workspace.slug, ctx.params.user_id);
      await revokeLinksByCreator(client, scope.workspace.slug, ctx.params.user_id);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'member.removed',
        target: member.email,
        detail: '',
      });
    });
    sendNoContent(ctx);
  });

  router.get('/api/w/:ws/invites', async (ctx) => {
    const scope = await ownerScope(ctx);
    const invites = await listInvites(scope.workspace.slug);
    sendJson(ctx, 200, { invites: invites.map((invite) => inviteJson(invite)) });
  });

  router.post('/api/w/:ws/invites', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const failures = onlyFields(body, ['email', 'role']);
    if (!isValidEmail(body.email)) failures.email = emailMessage;
    if (body.role !== 'developer' && body.role !== 'viewer') failures.role = roleMessage;
    if (Object.keys(failures).length > 0) throw validation(failures);
    const created = await transaction(async (client) => {
      await checkInviteRate(client, scope.workspace.slug);
      const invite = await createInvite(client, scope.workspace.slug, body.email as string, body.role as 'developer' | 'viewer');
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'invite.created',
        target: body.email as string,
        detail: body.role as string,
      });
      await mailInvite(client, {
        email: body.email as string,
        workspaceName: scope.workspace.name,
        role: body.role as string,
        acceptUrl: `${originOf(ctx)}/invite/${invite.token}`,
        expiresAt: new Date(invite.invite.expires_at),
      });
      return invite.invite;
    });
    sendJson(ctx, 201, inviteJson(created));
  });

  router.get('/api/w/:ws/keys', async (ctx) => {
    const scope = await ownerScope(ctx);
    const keys = await listKeys(scope.workspace.slug);
    sendJson(ctx, 200, { keys: keys.map((key) => keyJson(key)) });
  });

  router.post('/api/w/:ws/keys', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    requireStepUp(scope);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['description', 'permission', 'buckets', 'prefix', 'expires_at']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const buckets = await listBuckets(scope.workspace.slug);
    const input = validateKeyInput(body, buckets.map((bucket) => bucket.name));
    const created = await transaction(async (client) => {
      const result = await createKey(client, scope.workspace.slug, input);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'access_key.created',
        target: result.key.key_id,
        detail: input.description,
      });
      await mailKeyCreated(client, scope.workspace.slug, {
        keyId: result.key.key_id,
        workspaceName: scope.workspace.name,
        description: input.description,
        permission: input.permission,
        creatorName: scope.principal.user.name,
      });
      return result;
    });
    sendJson(ctx, 201, { ...keyJson(created.key), secret: created.secret });
  });

  router.post('/api/w/:ws/keys/:key_id/rotate', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    requireStepUp(scope);
    const rotated = await transaction(async (client) => {
      const key = await findKeyIn(client, scope.workspace.slug, ctx.params.key_id);
      if (!key) throw apiError('not_found');
      const result = await rotateKey(client, key);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'access_key.rotated',
        target: key.key_id,
        detail: '',
      });
      await mailKeyRotated(client, scope.workspace.slug, {
        keyId: key.key_id,
        workspaceName: scope.workspace.name,
        previousSecretExpiresAt: new Date(result.key.previous_secret_expires_at as string),
      });
      return result;
    });
    sendJson(ctx, 200, { ...keyJson(rotated.key), secret: rotated.secret });
  });

  router.post('/api/w/:ws/keys/:key_id/disable', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const disabled = await transaction(async (client) => {
      const key = await findKeyIn(client, scope.workspace.slug, ctx.params.key_id);
      if (!key) throw apiError('not_found');
      const result = await disableKey(client, key);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'access_key.disabled',
        target: key.key_id,
        detail: '',
      });
      return result;
    });
    sendJson(ctx, 200, keyJson(disabled));
  });

  router.delete('/api/w/:ws/keys/:key_id', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    await transaction(async (client) => {
      const key = await findKeyIn(client, scope.workspace.slug, ctx.params.key_id);
      if (!key) throw apiError('not_found');
      await deleteKey(client, key);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'access_key.deleted',
        target: key.key_id,
        detail: '',
      });
    });
    sendNoContent(ctx);
  });

  router.get('/api/w/:ws/webhooks', async (ctx) => {
    const scope = await ownerScope(ctx);
    const endpoints = await listEndpoints(scope.workspace.slug);
    sendJson(ctx, 200, { endpoints: endpoints.map(endpointJson) });
  });

  router.post('/api/w/:ws/webhooks', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['url', 'events', 'buckets', 'description']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const buckets = await listBuckets(scope.workspace.slug);
    const input = validateEndpoint(body, buckets.map((bucket) => bucket.name));
    const created = await transaction(async (client) => createEndpoint(client, scope.workspace.slug, input));
    sendJson(ctx, 201, { ...endpointJson(created.endpoint), secret: created.secret });
  });

  router.post('/api/w/:ws/webhooks/:id/disable', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const updated = await transaction(async (client) => {
      const endpoint = await findEndpoint(client, scope.workspace.slug, ctx.params.id);
      if (!endpoint) throw apiError('not_found');
      return setEndpointState(client, endpoint, 'disabled');
    });
    sendJson(ctx, 200, endpointJson(updated));
  });

  router.post('/api/w/:ws/webhooks/:id/enable', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const updated = await transaction(async (client) => {
      const endpoint = await findEndpoint(client, scope.workspace.slug, ctx.params.id);
      if (!endpoint) throw apiError('not_found');
      return setEndpointState(client, endpoint, 'active');
    });
    sendJson(ctx, 200, endpointJson(updated));
  });

  router.delete('/api/w/:ws/webhooks/:id', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    await transaction(async (client) => {
      const endpoint = await findEndpoint(client, scope.workspace.slug, ctx.params.id);
      if (!endpoint) throw apiError('not_found');
      await deleteEndpoint(client, endpoint);
    });
    sendNoContent(ctx);
  });

  router.get('/api/w/:ws/webhooks/:id/deliveries', async (ctx) => {
    const scope = await ownerScope(ctx);
    const endpoint = await transaction(async (client) => findEndpoint(client, scope.workspace.slug, ctx.params.id));
    if (!endpoint) throw apiError('not_found');
    const cursorText = ctx.query.get('cursor');
    let offset = 0;
    if (cursorText !== null) {
      offset = Number(cursorText);
      if (!Number.isInteger(offset) || offset < 0) throw validation({ cursor: 'This page link is no longer valid.' });
    }
    const page = await listDeliveries(endpoint.id, offset);
    sendJson(ctx, 200, {
      deliveries: page.slice(0, 50).map(deliveryJson),
      next_cursor: page.length > 50 ? String(offset + 50) : null,
    });
  });

  router.post('/api/w/:ws/webhooks/:id/deliveries/:delivery_id/redeliver', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    const updated = await transaction(async (client) => {
      const endpoint = await findEndpoint(client, scope.workspace.slug, ctx.params.id);
      if (!endpoint) throw apiError('not_found');
      return redeliver(client, endpoint.id, ctx.params.delivery_id);
    });
    sendJson(ctx, 202, deliveryJson(updated));
  });

  router.get('/api/w/:ws/encryption', async (ctx) => {
    const scope = await ownerScope(ctx);
    const counts = await query<{ key_generation: number; count: string }>(
      `select key_generation, count(*)::text as count from (
         select v.key_generation from object_versions v join buckets b on b.name = v.bucket where b.workspace_slug = $1
         union all
         select u.key_generation from multipart_uploads u where u.workspace_slug = $1 and u.state = 'open'
       ) all_keys group by key_generation order by key_generation`,
      [scope.workspace.slug],
    );
    const wrapped: Record<string, number> = {};
    for (const entry of counts) wrapped[String(entry.key_generation)] = Number(entry.count);
    sendJson(ctx, 200, {
      generation: Number(scope.workspace.key_generation),
      rotated_at: scope.workspace.key_rotated_at ? isoSecond(scope.workspace.key_rotated_at) : null,
      wrapped,
    });
  });

  router.post('/api/w/:ws/encryption/rotate', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await ownerScope(ctx);
    requireStepUp(scope);
    const result = await transaction(async (client) => {
      const workspace = await rows<{ key_generation: number; rotation_running: boolean }>(
        client,
        'select key_generation, rotation_running from workspaces where slug = $1 for update',
        [scope.workspace.slug],
      );
      if (workspace[0].rotation_running) throw apiError('rotation_in_progress');
      await client.query('update workspaces set rotation_running = true where slug = $1', [scope.workspace.slug]);
      const generation = Number(workspace[0].key_generation) + 1;
      const versions = await rows<{ version_id: string; key_generation: number; wrapped_data_key: string }>(
        client,
        `select v.version_id, v.key_generation, v.wrapped_data_key from object_versions v
         join buckets b on b.name = v.bucket where b.workspace_slug = $1 for update`,
        [scope.workspace.slug],
      );
      let rewrapped = 0;
      for (const version of versions) {
        const dataKey = unwrapDataKey(scope.workspace.slug, version.key_generation, version.wrapped_data_key);
        await client.query('update object_versions set wrapped_data_key = $2, key_generation = $3 where version_id = $1', [
          version.version_id,
          wrapDataKey(scope.workspace.slug, generation, dataKey),
          generation,
        ]);
        rewrapped += 1;
      }
      const uploads = await rows<{ upload_id: string; key_generation: number; wrapped_data_key: string }>(
        client,
        "select upload_id, key_generation, wrapped_data_key from multipart_uploads where workspace_slug = $1 and state = 'open' for update",
        [scope.workspace.slug],
      );
      for (const upload of uploads) {
        const dataKey = unwrapDataKey(scope.workspace.slug, upload.key_generation, upload.wrapped_data_key);
        await client.query('update multipart_uploads set wrapped_data_key = $2, key_generation = $3 where upload_id = $1', [
          upload.upload_id,
          wrapDataKey(scope.workspace.slug, generation, dataKey),
          generation,
        ]);
        rewrapped += 1;
      }
      await client.query(
        "update workspaces set key_generation = $2, key_rotated_at = date_trunc('second', now()), rotation_running = false where slug = $1",
        [scope.workspace.slug, generation],
      );
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'encryption.rotated',
        target: scope.workspace.slug,
        detail: `generation ${generation}`,
      });
      return { generation, rewrapped };
    });
    sendJson(ctx, 200, result);
  });

  router.get('/api/w/:ws/audit', async (ctx) => {
    const scope = await ownerScope(ctx);
    const filters = auditFilters(ctx);
    const page = await query<{
      seq: string;
      at: string;
      actor: string;
      action: string;
      target: string;
      detail: string;
      hash: string;
    }>(
      `select seq::text as seq, at, actor, action, target, detail, hash from audit_entries
       where workspace_slug = $1 and ($2::text is null or action = $2) and ($3::text is null or actor = $3)
         and ($4::bigint is null or seq <= $4)
       order by seq desc limit 51`,
      [scope.workspace.slug, filters.action, filters.actor, filters.cursor],
    );
    const entries = page.slice(0, 50);
    sendJson(ctx, 200, {
      entries: entries.map((entry) => ({
        seq: Number(entry.seq),
        at: isoSecond(entry.at),
        actor: entry.actor,
        action: entry.action,
        target: entry.target,
        detail: entry.detail,
        hash: entry.hash,
      })),
      next_cursor: page.length > 50 ? String(Number(page[50].seq)) : null,
    });
  });

  router.get('/api/w/:ws/audit/export.csv', async (ctx) => {
    const scope = await ownerScope(ctx);
    const filters = auditFilters(ctx);
    const entries = await query<{
      seq: string;
      at: string;
      actor: string;
      action: string;
      target: string;
      detail: string;
      prev_hash: string;
      hash: string;
    }>(
      `select seq::text as seq, at, actor, action, target, detail, prev_hash, hash from audit_entries
       where workspace_slug = $1 and ($2::text is null or action = $2) and ($3::text is null or actor = $3)
       order by seq`,
      [scope.workspace.slug, filters.action, filters.actor],
    );
    let csv = 'seq,at_utc,actor,action,target,detail,prev_hash,hash\n';
    for (const entry of entries) {
      csv += csvLine([
        entry.seq,
        isoSecond(entry.at),
        entry.actor,
        entry.action,
        entry.target,
        entry.detail,
        entry.prev_hash,
        entry.hash,
      ]);
    }
    sendText(ctx, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="farshore-${scope.workspace.slug}-audit.csv"`,
    });
  });

  router.get('/api/w/:ws/audit/verify', async (ctx) => {
    const scope = await ownerScope(ctx);
    const result = await transaction(async (client) => verifyChain(client, scope.workspace.slug));
    sendJson(ctx, 200, { ok: result.ok, entries: result.entries, first_broken_seq: result.firstBrokenSeq });
  });

  router.get('/api/w/:ws/usage', async (ctx) => {
    const scope = await ownerScope(ctx);
    const period = currentPeriod();
    const plan = planById(scope.workspace.plan_id);
    const buckets = await listBuckets(scope.workspace.slug);
    const storedBytes = buckets.reduce((total, bucket) => total + Number(bucket.stored_bytes), 0);
    const reserved = await query<{ total: string }>(
      'select coalesce(sum(bytes), 0)::text as total from quota_reservations where workspace_slug = $1',
      [scope.workspace.slug],
    );
    const totals = await monthToDate(scope.workspace.slug, period);
    const billing = await billingSummary(scope.workspace.slug, period);
    sendJson(ctx, 200, {
      period,
      plan: {
        id: plan.id,
        name: plan.name,
        included_storage_bytes: plan.includedStorageBytes,
        included_egress_bytes: plan.includedEgressBytes,
      },
      stored_bytes: storedBytes,
      reserved_bytes: Number(reserved[0]?.total ?? '0'),
      quota_bytes: quotaBytesForPlan(scope.workspace.plan_id),
      egress_bytes: totals.egressBytes,
      request_units: totals.requestUnits,
      storage_gb_hours: totals.storageGbHours,
      percent: {
        storage: roundPercent(storedBytes, plan.includedStorageBytes),
        egress: roundPercent(totals.egressBytes, plan.includedEgressBytes),
      },
      billing: {
        state: billing.state,
        unposted_rows: billing.unpostedRows,
        confirmed_through: billing.confirmedThrough,
      },
    });
  });

  router.get('/api/w/:ws/usage/rows', async (ctx) => {
    const scope = await ownerScope(ctx);
    const cursorText = ctx.query.get('cursor');
    let offset = 0;
    if (cursorText !== null) {
      offset = Number(cursorText);
      if (!Number.isInteger(offset) || offset < 0) throw validation({ cursor: 'This page link is no longer valid.' });
    }
    const page = await usageRowsPage(scope.workspace.slug, currentPeriod(), offset, 51);
    sendJson(ctx, 200, { rows: page.slice(0, 50), next_cursor: page.length > 50 ? String(offset + 50) : null });
  });

  router.get('/api/w/:ws/usage/export.csv', async (ctx) => {
    const scope = await ownerScope(ctx);
    const period = ctx.query.get('period') ?? currentPeriod();
    if (!/^\d{4}-\d{2}$/.test(period)) throw validation({ period: 'Use a period in the form YYYY-MM.' });
    const usage = await usageRowsForPeriod(scope.workspace.slug, period);
    let csv = 'window_start_utc,window_end_utc,bucket,unit,amount,tracking_id,billing_state\n';
    for (const usageRow of usage) {
      csv += `${usageRow.window_start},${usageRow.window_end},${usageRow.bucket},${usageRow.unit},${usageRow.amount},${usageRow.tracking_id},${usageRow.billing_state}\n`;
    }
    sendText(ctx, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="farshore-${scope.workspace.slug}-${period}.csv"`,
    });
  });
}

function auditFilters(ctx: Context): { action: string | null; actor: string | null; cursor: string | null } {
  const action = ctx.query.get('action');
  const actor = ctx.query.get('actor');
  const cursor = ctx.query.get('cursor');
  const failures: Record<string, string> = {};
  if (action !== null && action !== '' && !(auditActions as readonly string[]).includes(action)) {
    failures.action = 'Choose an action from the list.';
  }
  if (actor !== null && actor !== '' && (Array.from(actor).length < 1 || Array.from(actor).length > 320)) {
    failures.actor = 'Actors are 1 to 320 characters.';
  }
  if (cursor !== null && cursor !== '' && !/^\d+$/.test(cursor)) failures.cursor = 'This page link is no longer valid.';
  if (Object.keys(failures).length > 0) throw validation(failures);
  return {
    action: action === null || action === '' ? null : action,
    actor: actor === null || actor === '' ? null : actor,
    cursor: cursor === null || cursor === '' ? null : cursor,
  };
}
