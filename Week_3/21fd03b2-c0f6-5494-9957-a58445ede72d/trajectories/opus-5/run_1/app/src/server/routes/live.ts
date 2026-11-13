import type { PresenceResponse } from '../../shared/api.js';
import { fieldCopy } from '../../shared/copy.js';
import { parseDocument } from '../../shared/scene.js';
import { canEditScenes } from '../../shared/states.js';
import { faults } from '../errors.js';
import { noContent, ok, type Ctx, type Reply, type Route } from '../http.js';
import {
  acquireLease,
  clearPresence,
  listLeases,
  listPresence,
  releaseLease,
  releaseLeasesForTab,
  writePresence,
} from '../locks.js';
import { requireScene, roleIn, sceneById } from '../repo.js';
import { serviceStatus } from '../status.js';
import { valkey } from '../valkey.js';

const TAB_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function requireTab(value: string | null): string {
  if (value === null || !TAB_PATTERN.test(value))
    throw faults.validation({ tab: fieldCopy.notANumber });
  return value;
}

async function requireLockStore(): Promise<void> {
  if (!(await valkey.ping())) throw faults.lockStoreUnavailable();
}

async function takeLock(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canEditScenes(found.role)) throw faults.forbidden();
  await requireLockStore();
  const document = parseDocument(found.scene.document);
  if (!document.objects.some((object) => object.id === ctx.params.objectId))
    throw faults.notFound();
  const body = ctx.body();
  const tab = typeof body.tab === 'string' && body.tab !== '' ? requireTab(body.tab) : '';
  const result = await acquireLease(
    found.scene.id,
    ctx.params.objectId,
    { userId: account.id, displayName: account.displayName },
    tab,
  );
  if (!result.granted) throw faults.lockHeld(result.holder, result.expiresAt);
  return ok({ lock: result.lease });
}

async function dropLock(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canEditScenes(found.role)) throw faults.forbidden();
  await requireLockStore();
  const tabValue = ctx.query('tab');
  const tab = tabValue === null || tabValue === '' ? '' : requireTab(tabValue);
  const released = await releaseLease(found.scene.id, ctx.params.objectId, account.id, tab);
  if (!released) {
    const leases = await listLeases(found.scene.id);
    const held = leases.find((lease) => lease.objectId === ctx.params.objectId);
    if (held) throw faults.lockHeld(held.holder, held.expiresAt);
  }
  return noContent();
}

async function putPresence(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  await requireLockStore();
  const body = ctx.body();
  const tab = requireTab(typeof body.tab === 'string' ? body.tab : null);
  const cursorValue = body.cursor;
  const cursor =
    Array.isArray(cursorValue) &&
    cursorValue.length === 3 &&
    cursorValue.every((part) => typeof part === 'number')
      ? ([cursorValue[0], cursorValue[1], cursorValue[2]] as [number, number, number])
      : null;
  const selected = typeof body.selected === 'string' ? body.selected : null;
  await writePresence(
    found.scene.id,
    { userId: account.id, displayName: account.displayName },
    { tab, cursor, selected },
  );
  return noContent();
}

async function deletePresence(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  await requireLockStore();
  const tab = requireTab(ctx.query('tab'));
  await clearPresence(found.scene.id, account.id, tab);
  await releaseLeasesForTab(found.scene.id, account.id, tab);
  return noContent();
}

export async function presenceBody(sceneId: string): Promise<PresenceResponse> {
  const [people, locks] = await Promise.all([listPresence(sceneId), listLeases(sceneId)]);
  return { people, locks };
}

async function getPresence(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  await requireLockStore();
  return ok(await presenceBody(found.scene.id));
}

async function liveChannel(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  const tab = requireTab(ctx.query('tab'));
  const { res } = ctx;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const write = (event: string, data: unknown): void => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let lastRevision = -1;
  let lastPresence = '';
  let lastRole = '';
  let lastStatus = '';
  let closed = false;

  await writePresence(
    found.scene.id,
    { userId: account.id, displayName: account.displayName },
    { tab, cursor: null, selected: null },
  ).catch(() => undefined);

  const poll = async (): Promise<void> => {
    if (closed) return;
    const scene = await sceneById(found.scene.id).catch(() => null);
    if (scene && scene.revision !== lastRevision) {
      lastRevision = scene.revision;
      write('revision', { revision: scene.revision, stateHash: scene.state_hash });
    }
    const presence = await presenceBody(found.scene.id).catch(() => null);
    if (presence) {
      const encoded = JSON.stringify(presence);
      if (encoded !== lastPresence) {
        lastPresence = encoded;
        write('presence', presence);
      }
    }
    const role = await roleIn(found.workspaceId, account.id).catch(() => null);
    if (role === null) {
      write('role', { role: 'viewer' });
    } else if (role !== lastRole) {
      lastRole = role;
      write('role', { role });
    }
    const status = await serviceStatus().catch(() => null);
    if (status) {
      const encoded = JSON.stringify(status);
      if (encoded !== lastStatus) {
        lastStatus = encoded;
        write('status', status);
      }
    }
  };

  const pollTimer = setInterval(() => void poll(), 1_000);
  const commentTimer = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 10_000);
  void poll();

  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(commentTimer);
    void clearPresence(found.scene.id, account.id, tab).catch(() => undefined);
    void releaseLeasesForTab(found.scene.id, account.id, tab).catch(() => undefined);
    if (!res.writableEnded) res.end();
  };

  ctx.req.on('close', finish);
  ctx.req.on('aborted', finish);
  return { status: 200, handled: true };
}

export const liveRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/scenes/:sid/locks/:objectId', handler: takeLock },
  { method: 'DELETE', pattern: '/api/scenes/:sid/locks/:objectId', handler: dropLock },
  { method: 'PUT', pattern: '/api/scenes/:sid/presence', handler: putPresence },
  { method: 'DELETE', pattern: '/api/scenes/:sid/presence', handler: deletePresence },
  { method: 'GET', pattern: '/api/scenes/:sid/presence', handler: getPresence },
  { method: 'GET', pattern: '/api/scenes/:sid/live', handler: liveChannel },
];
