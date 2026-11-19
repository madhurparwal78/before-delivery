import type { Pool, QueryResultRow } from 'pg';
import { ApiError, rowToBulletRow, nextSeq, rowToAccount } from './store.js';
import type { BulletRow, Account, ShareRow } from '../domain/types.js';
import { toBulletView, extractMentions, extractTags, rewriteDates } from '../domain/text.js';
import { viewOrder, branchIds, isTrashed, childRows } from '../domain/tree.js';
import type { Config } from './config.js';

export interface ChangeBroadcaster {
  (ownerId: string, message: Record<string, unknown>): void;
}

export interface OutlineScope {
  ownerId: string;
  isCollaborator: boolean;
  collaboratorRootId: string | null;
}

export interface OutlineServiceContext {
  pool: Pool;
  config: Config;
  today: string;
  broadcast: ChangeBroadcaster;
}

export function nowMs(): number {
  return Date.now();
}

export async function loadScope(
  pool: Pool,
  viewer: Account,
  rootId: string | null,
  now: number,
  config: Config,
): Promise<{ scope: OutlineScope; rows: Map<string, BulletRow>; root: BulletRow | null; ancestors: BulletRow[] }> {
  if (rootId === null) {
    const rows = await loadOwnedRows(pool, viewer.id);
    return { scope: { ownerId: viewer.id, isCollaborator: false, collaboratorRootId: null }, rows, root: null, ancestors: [] };
  }
  const target = await bulletById(pool, rootId);
  if (!target) throw new ApiError(404, { error: 'not_found' });
  const ownerRow = target.ownerId === viewer.id ? null : await findAcceptedShare(pool, viewer.email, rootId);
  if (target.ownerId !== viewer.id && !ownerRow) throw new ApiError(404, { error: 'not_found' });
  if (isTrashed(target, now, config.trashSeconds)) throw new ApiError(404, { error: 'not_found' });
  const scope: OutlineScope = {
    ownerId: target.ownerId,
    isCollaborator: target.ownerId !== viewer.id,
    collaboratorRootId: target.ownerId !== viewer.id ? rootId : null,
  };
  const rows = scope.isCollaborator
    ? await loadBranchRowsFor(pool, scope.ownerId, rootId)
    : await loadOwnedRows(pool, viewer.id);
  const ancestors = await loadAncestors(pool, rows, target, scope);
  return { scope, rows, root: target, ancestors };
}

export async function loadOwnedRows(pool: Pool, ownerId: string): Promise<Map<string, BulletRow>> {
  const result = await pool.query(
    `select * from bullets where owner_id = $1 and purged = false`,
    [ownerId],
  );
  return rowsToMap(result.rows);
}

export async function loadBranchRowsFor(pool: Pool, ownerId: string, rootId: string): Promise<Map<string, BulletRow>> {
  const result = await pool.query(
    `with recursive branch as (
       select * from bullets where id = $1 and owner_id = $2 and purged = false
       union all
       select b.* from bullets b join branch on b.parent_id = branch.id where b.purged = false
     ) select * from branch`,
    [rootId, ownerId],
  );
  const map = new Map<string, BulletRow>();
  for (const row of result.rows) {
    map.set(String(row.id), rowToBulletRow(row));
  }
  return map;
}

export function rowsToMap(rows: QueryResultRow[]): Map<string, BulletRow> {
  const map = new Map<string, BulletRow>();
  for (const row of rows) {
    const bullet = rowToBulletRow(row);
    map.set(bullet.id, bullet);
  }
  return map;
}

export async function bulletById(pool: Pool, id: string): Promise<BulletRow | null> {
  const rows = await pool.query(`select * from bullets where id = $1`, [id]);
  return rows.rows[0] ? rowToBulletRow(rows.rows[0]) : null;
}

export async function findAcceptedShare(pool: Pool, email: string, bulletId: string): Promise<ShareRow | null> {
  const rows = await pool.query(
    `select * from shares where email = $1 and bullet_id = $2 and status = 'accepted'`,
    [email, bulletId],
  );
  return rows.rows[0] ? { ...rowToShare(rows.rows[0]) } : null;
}

export async function loadAncestors(
  pool: Pool,
  rows: Map<string, BulletRow>,
  root: BulletRow,
  scope: OutlineScope,
): Promise<BulletRow[]> {
  const chain: BulletRow[] = [];
  let current: BulletRow | undefined = root;
  const seen = new Set<string>();
  while (current && current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parentRow: BulletRow | null = rows.get(current.parentId) ?? (await bulletById(pool, current.parentId));
    if (!parentRow) break;
    if (scope.isCollaborator && parentRow.id === scope.collaboratorRootId) break;
    chain.unshift(parentRow);
    current = parentRow;
  }
  return chain;
}

export function rowToShare(row: QueryResultRow): ShareRow {
  return {
    id: String(row.id),
    bulletId: String(row.bullet_id),
    ownerId: String(row.owner_id),
    email: String(row.email),
    token: String(row.token),
    status: row.status as ShareRow['status'],
    createdAt: Number(row.created_at),
  };
}

export interface OutlinePayload {
  root: ReturnType<typeof toBulletView> | null;
  ancestors: ReturnType<typeof toBulletView>[];
  seq: number;
  bullets: ReturnType<typeof toBulletView>[];
}

export async function buildOutlinePayload(
  pool: Pool,
  config: Config,
  scope: OutlineScope,
  rows: Map<string, BulletRow>,
  root: BulletRow | null,
  ancestors: BulletRow[],
  now: number,
): Promise<OutlinePayload> {
  const entries = viewOrder(rows, root ? root.id : null, now, config.trashSeconds);
  const bullets: ReturnType<typeof toBulletView>[] = [];
  for (const entry of entries) {
    const childCount = childRows(rows, entry.placement.id).filter(
      (r) => !isTrashed(r, now, config.trashSeconds),
    ).length;
    const depth = root ? entry.depth + 1 : entry.depth;
    let viewDepth = depth;
    if (scope.isCollaborator && scope.collaboratorRootId) {
      viewDepth = Math.max(1, depth);
    }
    bullets.push(toBulletView(entry.placement, viewDepth, entry.placeholder, childCount));
  }
  const seq = await currentSeq(pool, scope.ownerId);
  const rootView = root
    ? toBulletView(root, 0, false, childRows(rows, root.id).filter((r) => !isTrashed(r, now, config.trashSeconds)).length)
    : null;
  const ancestorViews = ancestors.map((a) => {
    const childCount = childRows(rows, a.id).filter((r) => !isTrashed(r, now, config.trashSeconds)).length;
    return toBulletView(a, 0, false, childCount);
  });
  return { root: rootView, ancestors: ancestorViews, seq, bullets };
}

export async function currentSeq(pool: Pool, ownerId: string): Promise<number> {
  const rows = await pool.query(`select seq from outline_seq where owner_id = $1`, [ownerId]);
  return rows.rows[0] ? Number(rows.rows[0].seq) : 0;
}

export interface ChangeEntry {
  seq: number;
  changed: BulletRow[];
  removed: string[];
}

export async function commitChange(
  pool: Pool,
  scope: OutlineScope,
  changed: BulletRow[],
  removed: string[],
): Promise<number> {
  const seq = await nextSeq(pool, scope.ownerId);
  await pool.query(
    `insert into change_log (owner_id, seq, message, created_at) values ($1,$2,$3,$4)
     on conflict (owner_id, seq) do nothing`,
    [scope.ownerId, seq, JSON.stringify({ changed: changed.map((c) => c.id), removed }), Date.now()],
  );
  return seq;
}

export function bulletCounts(rows: Map<string, BulletRow>, bulletId: string, now: number, trashSeconds: number): number {
  const ids = branchIds(rows, bulletId);
  let count = 0;
  for (const id of ids) {
    const row = rows.get(id);
    if (row && !isTrashed(row, now, trashSeconds)) count += 1;
  }
  return count;
}

export async function accountByIdRow(pool: Pool, id: string): Promise<Account | null> {
  const rows = await pool.query(`select * from accounts where id = $1`, [id]);
  return rows.rows[0] ? rowToAccount(rows.rows[0]) : null;
}

export function saveTextTransform(text: string, today: string): { text: string; date: string | null; tags: string[]; mentions: string[] } {
  const { canonicalText, date } = rewriteDates(text, today);
  return {
    text: canonicalText,
    date,
    tags: extractTags(canonicalText),
    mentions: extractMentions(canonicalText),
  };
}
