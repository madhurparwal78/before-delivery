import type { ShareLinkRow, ViewProjectResponse } from '../../shared/api.js';
import { parseDocument } from '../../shared/scene.js';
import { simulateHash } from '../../shared/sim.js';
import { canAdminister } from '../../shared/states.js';
import { CONTENT_TYPES } from '../../shared/uploads.js';
import { publicAddress, config } from '../config.js';
import { one, query } from '../db.js';
import { faults } from '../errors.js';
import { newId, newToken } from '../ids.js';
import { created, noContent, ok, raw, type Ctx, type Reply, type Route } from '../http.js';
import { queueMessage, shareMessage } from '../mailer.js';
import {
  assetRow,
  recordActivity,
  requireEmail,
  requireProject,
  sceneRecord,
  type AssetDbRow,
} from '../repo.js';
import { StorageDown, getObject, storageKeys } from '../s3.js';
import { parseVerifyRequest } from '../verify.js';

interface LinkDbRow {
  id: string;
  project_id: string;
  token: string;
  active: boolean;
  expires_at: Date;
}

function linkJson(row: LinkDbRow): ShareLinkRow {
  return {
    id: row.id,
    token: row.token,
    url: publicAddress(`/view/${row.token}`),
    expiresAt: row.expires_at.toISOString(),
  };
}

async function createShareLink(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const project = await requireProject(ctx.params.pid, account.id);
  if (!canAdminister(project.role)) throw faults.forbidden();
  const body = ctx.body();
  const wantsEmail = typeof body.email === 'string' && body.email !== '';
  const email = wantsEmail ? requireEmail(body) : null;
  const expiresAt = new Date(Date.now() + config.shareLinkTtlSeconds * 1000);
  const rows = await query<LinkDbRow>(
    `insert into share_links (id, project_id, token, expires_at) values ($1,$2,$3,$4)
     returning id, project_id, token, active, expires_at`,
    [newId(), project.projectId, newToken(), expiresAt.toISOString()],
  );
  const link = rows[0];
  await recordActivity(project.workspaceId, account.id, 'share_link.created', project.projectName);
  let delivery: 'sent' | 'queued' | null = null;
  if (email) {
    delivery = await queueMessage({
      kind: 'share',
      refId: link.id,
      ...shareMessage({
        sharer: account.displayName,
        projectName: project.projectName,
        email,
        token: link.token,
        expiresAt: expiresAt.toISOString(),
      }),
    });
  }
  return created({ link: linkJson(link), delivery });
}

async function listShareLinks(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const project = await requireProject(ctx.params.pid, account.id);
  if (!canAdminister(project.role)) throw faults.forbidden();
  const rows = await query<LinkDbRow>(
    `select id, project_id, token, active, expires_at from share_links
      where project_id = $1 and active and expires_at > now() order by created_at`,
    [project.projectId],
  );
  return ok({ links: rows.map(linkJson) });
}

async function linkForOwner(ctx: Ctx, linkId: string): Promise<{ link: LinkDbRow; workspaceId: string; projectName: string }> {
  const account = await ctx.requireAccount();
  const row = await one<LinkDbRow & { workspace_id: string; project_name: string; role: string }>(
    `select l.id, l.project_id, l.token, l.active, l.expires_at,
            p.workspace_id, p.name as project_name, m.role
       from share_links l
       join projects p on p.id = l.project_id
       join memberships m on m.workspace_id = p.workspace_id
      where l.id = $1 and m.user_id = $2`,
    [linkId, account.id],
  );
  if (!row) throw faults.notFound();
  if (row.role !== 'owner') throw faults.forbidden();
  return {
    link: {
      id: row.id,
      project_id: row.project_id,
      token: row.token,
      active: row.active,
      expires_at: row.expires_at,
    },
    workspaceId: row.workspace_id,
    projectName: row.project_name,
  };
}

async function regenerateShareLink(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await linkForOwner(ctx, ctx.params.id);
  const expiresAt = new Date(Date.now() + config.shareLinkTtlSeconds * 1000);
  const rows = await query<LinkDbRow>(
    `update share_links set token = $1, expires_at = $2, active = true where id = $3
     returning id, project_id, token, active, expires_at`,
    [newToken(), expiresAt.toISOString(), found.link.id],
  );
  await recordActivity(
    found.workspaceId,
    account.id,
    'share_link.regenerated',
    found.projectName,
  );
  return created({ link: linkJson(rows[0]) });
}

async function revokeShareLink(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await linkForOwner(ctx, ctx.params.id);
  await query('update share_links set active = false where id = $1', [found.link.id]);
  await recordActivity(found.workspaceId, account.id, 'share_link.revoked', found.projectName);
  return noContent();
}

/* ------------------------------------------------------- public reading --- */

interface LiveLink {
  id: string;
  projectId: string;
  projectName: string;
  token: string;
}

async function liveLink(token: string): Promise<LiveLink> {
  const row = await one<{ id: string; project_id: string; project_name: string; token: string }>(
    `select l.id, l.project_id, p.name as project_name, l.token
       from share_links l join projects p on p.id = l.project_id
      where l.token = $1 and l.active and l.expires_at > now()`,
    [token],
  );
  if (!row) throw faults.linkNotFound();
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    token: row.token,
  };
}

async function viewProject(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token);
  const scenes = await query<{ id: string; name: string; state_hash: string }>(
    'select id, name, state_hash from scenes where project_id = $1 order by created_at',
    [link.projectId],
  );
  const response: ViewProjectResponse = {
    project: { name: link.projectName },
    scenes: scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      stateHash: scene.state_hash,
    })),
  };
  return ok(response);
}

async function viewSceneRow(linkProjectId: string, sceneId: string) {
  const scene = await one<{
    id: string;
    project_id: string;
    name: string;
    status: 'draft' | 'checkpointed' | 'published' | 'unpublished';
    revision: number;
    state_hash: string;
    document: string;
    restore_revision: number;
  }>(
    `select id, project_id, name, status, revision, state_hash, document, restore_revision
       from scenes where id = $1 and project_id = $2`,
    [sceneId, linkProjectId],
  );
  if (!scene) throw faults.linkNotFound();
  return scene;
}

async function viewScene(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token);
  const scene = await viewSceneRow(link.projectId, ctx.params.sid);
  const document = parseDocument(scene.document);
  const used = new Set(
    document.objects
      .filter((object) => object.assetId !== null)
      .map((object) => object.assetId as string),
  );
  const assets = await query<AssetDbRow>(
    `select id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at
       from assets where project_id = $1`,
    [link.projectId],
  );
  return ok({
    scene: await sceneRecord(scene),
    document,
    assets: assets.filter((asset) => used.has(asset.id)).map(assetRow),
  });
}

async function viewSceneLive(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token);
  const scene = await viewSceneRow(link.projectId, ctx.params.sid);
  const { res } = ctx;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  let lastRevision = -1;
  let closed = false;
  const write = (event: string, data: unknown): void => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const poll = async (): Promise<void> => {
    if (closed) return;
    const alive = await one<{ id: string }>(
      'select id from share_links where token = $1 and active and expires_at > now()',
      [link.token],
    ).catch(() => null);
    if (!alive) {
      write('link_dead', {});
      finish();
      return;
    }
    const row = await one<{ revision: number; state_hash: string }>(
      'select revision, state_hash from scenes where id = $1',
      [scene.id],
    ).catch(() => null);
    if (row && row.revision !== lastRevision) {
      lastRevision = row.revision;
      write('revision', { revision: row.revision, stateHash: row.state_hash });
    }
  };
  const pollTimer = setInterval(() => void poll(), 1_500);
  const commentTimer = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 10_000);
  function finish(): void {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(commentTimer);
    if (!res.writableEnded) res.end();
  }
  ctx.req.on('close', finish);
  ctx.req.on('aborted', finish);
  void poll();
  return { status: 200, handled: true };
}

async function viewAsset(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token);
  const asset = await one<AssetDbRow>(
    `select id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at
       from assets where project_id = $1 and sha256 = $2 and kind in ('glb','gltf')`,
    [link.projectId, ctx.params.sha256],
  );
  if (!asset) throw faults.linkNotFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.asset(asset.project_id, asset.sha256));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.linkNotFound();
  return raw(bytes, CONTENT_TYPES[asset.kind], { etag: `"${asset.sha256}"` });
}

async function viewVerify(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token);
  const scene = await viewSceneRow(link.projectId, ctx.params.sid);
  const document = parseDocument(scene.document);
  const input = parseVerifyRequest(ctx.body(), document, null);
  return ok(simulateHash(document, input.steps, input.params));
}

export const shareRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/projects/:pid/share-links', handler: createShareLink },
  { method: 'GET', pattern: '/api/projects/:pid/share-links', handler: listShareLinks },
  { method: 'POST', pattern: '/api/share-links/:id/regenerate', handler: regenerateShareLink },
  { method: 'DELETE', pattern: '/api/share-links/:id', handler: revokeShareLink },
  { method: 'GET', pattern: '/api/view/:token', handler: viewProject, open: true },
  { method: 'GET', pattern: '/api/view/:token/scenes/:sid', handler: viewScene, open: true },
  {
    method: 'GET',
    pattern: '/api/view/:token/scenes/:sid/live',
    handler: viewSceneLive,
    open: true,
  },
  { method: 'GET', pattern: '/api/view/:token/assets/:sha256', handler: viewAsset, open: true },
  {
    method: 'POST',
    pattern: '/api/view/:token/scenes/:sid/verify',
    handler: viewVerify,
    open: true,
  },
];
