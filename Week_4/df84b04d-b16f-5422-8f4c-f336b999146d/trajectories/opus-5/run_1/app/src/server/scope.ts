import type { PoolClient } from 'pg';
import { notFound } from './errors.js';
import { query } from './db.js';
import { loadTree, type Tree } from './tree.js';

export interface Viewer {
  userId: string;
  email: string;
  name: string;
  hideCompleted: boolean;
}

/** Which outline a request is working in, and the shared bullet that bounds it. */
export interface Scope {
  viewer: Viewer;
  ownerId: string;
  /** The collaborator's shared bullet, or null when the viewer owns the outline. */
  shareRootId: string | null;
}

export interface AcceptedShare {
  bulletId: string;
  ownerId: string;
  ownerName: string;
}

export async function acceptedShares(email: string): Promise<AcceptedShare[]> {
  const rows = await query<{ bullet_id: string; owner_id: string; name: string }>(
    `select s.bullet_id, s.owner_id, u.name
       from shares s
       join users u on u.id = s.owner_id
       join bullets b on b.id = s.bullet_id
      where s.email = $1 and s.status = 'accepted' and b.trashed_at is null
      order by s.created_at`,
    [email]
  );
  return rows.map((row) => ({ bulletId: row.bullet_id, ownerId: row.owner_id, ownerName: row.name }));
}

/** The viewer's own outline. */
export function ownScope(viewer: Viewer): Scope {
  return { viewer, ownerId: viewer.userId, shareRootId: null };
}

async function ownerOf(bulletId: string, client?: PoolClient): Promise<string | null> {
  const sql = `select owner_id from bullets where id = $1 and trashed_at is null`;
  const rows = client
    ? ((await client.query(sql, [bulletId])).rows as Array<{ owner_id: string }>)
    : await query<{ owner_id: string }>(sql, [bulletId]);
  return rows[0]?.owner_id ?? null;
}

/**
 * Resolves the scope a bullet id is reachable in, or answers not found.
 * This is the one place collaborator scope is decided.
 */
export async function scopeForBullet(
  viewer: Viewer,
  bulletId: string,
  client?: PoolClient
): Promise<{ scope: Scope; tree: Tree }> {
  const ownerId = await ownerOf(bulletId, client);
  if (ownerId === null) throw notFound();
  if (ownerId === viewer.userId) {
    return { scope: ownScope(viewer), tree: await loadTree(ownerId, client) };
  }
  const shares = await acceptedShares(viewer.email);
  const tree = await loadTree(ownerId, client);
  for (const share of shares) {
    if (share.ownerId !== ownerId) continue;
    if (tree.inBranch(bulletId, share.bulletId)) {
      return { scope: { viewer, ownerId, shareRootId: share.bulletId }, tree };
    }
  }
  throw notFound();
}

/** Resolves the scope of a view root, where a missing root means the viewer's own outline. */
export async function scopeForRoot(
  viewer: Viewer,
  rootId: string | null
): Promise<{ scope: Scope; tree: Tree; rootId: string | null }> {
  if (rootId === null) {
    return { scope: ownScope(viewer), tree: await loadTree(viewer.userId), rootId: null };
  }
  const resolved = await scopeForBullet(viewer, rootId);
  return { ...resolved, rootId };
}

/** Refuses any id the viewer cannot open inside an already resolved scope. */
export function requireOpen(scope: Scope, tree: Tree, bulletId: string): void {
  const row = tree.row(bulletId);
  if (row === undefined) throw notFound();
  if (scope.shareRootId !== null && !tree.inBranch(bulletId, scope.shareRootId)) throw notFound();
}

/** The depth the viewer's outline counts from: a collaborator starts at the shared bullet. */
export function baseDepth(scope: Scope, tree: Tree, rootId: string | null): number {
  if (rootId === null) return 0;
  if (scope.shareRootId === null) return tree.depthOf(rootId);
  return tree.displayDistance(scope.shareRootId, rootId);
}
