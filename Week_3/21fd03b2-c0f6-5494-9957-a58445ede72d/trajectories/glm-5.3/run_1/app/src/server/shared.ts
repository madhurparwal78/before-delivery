import type { Request, Response } from 'express';
import { withClient, type DbClient } from './db';
import { AppError, notFound } from './errors';
import { loadScene, type SceneRow } from './scenes';
import { listPresence, listLocks, locksStatus, releaseAllLeasesForTab, dropPresence } from './locks';
import { storageStatus } from './storage';
import { mailStatus } from './mail';

export const PUBLIC_URL = (process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
export const INVITE_TTL = Number(process.env.INVITE_TTL_SECONDS ?? 604800);
export const SHARE_TTL = Number(process.env.SHARE_LINK_TTL_SECONDS ?? 2592000);

export type SessionUser = { id: string; email: string; displayName: string };

export async function roleIn(client: DbClient, workspaceId: string, userId: string): Promise<'owner' | 'editor' | 'viewer' | null> {
  const row = await client.query('SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return row.rows[0]?.role ?? null;
}

export async function projectWorkspace(client: DbClient, projectId: string): Promise<string | null> {
  const row = await client.query('SELECT workspace_id FROM projects WHERE id = $1', [projectId]);
  return row.rows[0]?.workspace_id ?? null;
}

export async function workspaceName(client: DbClient, workspaceId: string): Promise<string> {
  const row = await client.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
  return row.rows[0].name;
}

export function extractCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]+)`).exec(raw);
  return match ? match[1]! : null;
}

export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = extractCookie(req, 'rw_session');
  if (!token) return null;
  const row = await withClient(async (client) => {
    const result = await client.query(
      'SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
      [token],
    );
    return result.rows[0];
  });
  if (!row) return null;
  (req as Request & { sessionToken: string }).sessionToken = token;
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  return user;
}

export async function requireRole(workspaceId: string, userId: string, minimum: Array<'owner' | 'editor' | 'viewer'>): Promise<'owner' | 'editor' | 'viewer'> {
  const role = await withClient(async (client) => roleIn(client, workspaceId, userId));
  if (!role) throw notFound();
  if (!minimum.includes(role)) throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  return role;
}

export async function requireRoleForProject(projectId: string, userId: string, minimum: Array<'owner' | 'editor' | 'viewer'>): Promise<string> {
  const workspaceId = await withClient(async (client) => projectWorkspace(client, projectId));
  if (!workspaceId) throw notFound();
  await requireRole(workspaceId, userId, minimum);
  return workspaceId;
}

export type SceneAccess = { scene: SceneRow; workspaceId: string; role: 'owner' | 'editor' | 'viewer' };

export async function loadSceneWithAccess(sceneId: string, userId: string): Promise<SceneAccess> {
  const data = await withClient(async (client) => {
    const scene = await loadScene(client, sceneId);
    if (!scene) return null;
    const workspaceId = await projectWorkspace(client, scene.project_id);
    if (!workspaceId) return null;
    const role = await roleIn(client, workspaceId, userId);
    if (!role) return null;
    return { scene, workspaceId, role };
  });
  if (!data || !data.role) throw notFound();
  return data;
}

export function jsonBody(req: Request): Record<string, unknown> {
  const withBody = req as Request & { jsonBody?: unknown; bodyError?: AppError };
  if (withBody.bodyError) throw withBody.bodyError;
  if (withBody.jsonBody === undefined) throw new AppError(415, 'unsupported_media_type', 'This endpoint accepts JSON.');
  return withBody.jsonBody as Record<string, unknown>;
}

export function rawBody(req: Request): Buffer {
  const withBody = req as Request & { rawBody?: Buffer };
  return withBody.rawBody ?? Buffer.alloc(0);
}

// ---------- live channels ----------

type Channel = {
  res: Response;
  sceneId: string;
  userId: string;
  tab: string;
  role: string;
  workspaceId: string;
};

const channels = new Set<Channel>();
let statusCache: { at: number; body: Record<string, string> } | null = null;

export async function statusBody(): Promise<{ locks: string; storage: string; mail: string }> {
  if (statusCache && Date.now() - statusCache.at < 3000) return statusCache.body as never;
  const [locks, storage, mail] = await Promise.all([locksStatus(), storageStatus(), mailStatus()]);
  const body = { locks, storage, mail };
  statusCache = { at: Date.now(), body };
  return body as never;
}

export function invalidateStatus(): void {
  statusCache = null;
}

export async function presenceBody(sceneId: string): Promise<{
  people: Array<{ userId: string; displayName: string; cursor: [number, number, number] | null; selected: string | null }>;
  locks: Array<{ objectId: string; holder: { userId: string; displayName: string }; fence: number; expiresAt: string }>;
}> {
  const rows = await withClient(async (client) => {
    const scene = await loadScene(client, sceneId);
    if (!scene) return null;
    const doc = JSON.parse((await client.query('SELECT document FROM scene_revisions WHERE scene_id = $1 AND revision = $2', [sceneId, scene.revision])).rows[0].document as string) as { objects: Array<{ id: string }> };
    return doc.objects.map((o) => o.id);
  });
  const presence = await listPresence(sceneId);
  const people = new Map<string, { userId: string; displayName: string; cursor: [number, number, number] | null; selected: string | null }>();
  for (const p of presence) {
    const existing = people.get(p.userId);
    people.set(p.userId, {
      userId: p.userId,
      displayName: existing?.displayName ?? p.rec.displayName,
      cursor: p.rec.cursor,
      selected: p.rec.selected,
    });
  }
  const locks = (await listLocks(sceneId, rows ?? [])).map((l) => ({
    objectId: l.objectId,
    holder: { userId: l.holder.userId, displayName: l.holder.displayName },
    fence: l.holder.fence,
    expiresAt: new Date(Date.now() + 30000).toISOString(),
  }));
  return { people: [...people.values()], locks };
}

export function notifyChannels(sceneId: string, event: { type: 'revision'; revision: number; stateHash: string } | { type: 'presence' } | { type: 'status' }): void {
  for (const channel of channels) {
    if (channel.sceneId !== sceneId) continue;
    sendEvent(channel.res, event.type === 'revision' ? 'revision' : event.type === 'presence' ? 'presence' : 'status', event.type === 'revision' ? { revision: event.revision, stateHash: event.stateHash } : event.type === 'presence' ? {} : {});
  }
}

export function notifyAllWorkspaceChannels(workspaceId: string, userId: string, role: string): void {
  for (const channel of channels) {
    if (channel.workspaceId === workspaceId && channel.userId === userId) {
      sendEvent(channel.res, 'role', { role });
    }
  }
}

export function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function registerSceneChannel(
  res: Response,
  sceneId: string,
  userId: string,
  tab: string,
  role: string,
  workspaceId: string,
): Promise<void> {
  const channel: Channel = { res, sceneId, userId, tab, role, workspaceId };
  channels.add(channel);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  sendEvent(res, 'presence', await presenceBody(sceneId));
  const heartbeat = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 10000);
  const presenceTimer = setInterval(async () => {
    try {
      sendEvent(res, 'presence', await presenceBody(sceneId));
    } catch {
      clearInterval(presenceTimer);
    }
  }, 2000);
  const closeHandler = (): void => {
    clearInterval(heartbeat);
    clearInterval(presenceTimer);
    channels.delete(channel);
    void releaseTabResources(sceneId, userId, tab);
  };
  res.on('close', closeHandler);
  res.on('error', () => {
    clearInterval(heartbeat);
    clearInterval(presenceTimer);
    channels.delete(channel);
  });
}

async function releaseTabResources(sceneId: string, userId: string, tab: string): Promise<void> {
  try {
    await releaseAllLeasesForTab(sceneId, userId, tab);
    await dropPresence(sceneId, userId, tab);
  } catch {
    // service down; TTL is the fallback
  }
}

