import type { BulletRow } from './types.js';
import type { Config } from '../server/config.js';
import { ApiError, rowToBulletRow } from '../server/store.js';
import type { QueryResultRow } from 'pg';

export interface ViewRow {
  row: BulletRow;
  placeholder: boolean;
}

export interface OutlineRead {
  ownerId: string;
  rows: Map<string, BulletRow>;
  rootId: string | null;
  root: BulletRow | null;
  isShared: boolean;
  sharedBulletId: string | null;
}

export async function loadOutlineRows(
  pool: { query: (sql: string, params?: readonly unknown[]) => Promise<QueryResultRow[]> },
  ownerId: string,
): Promise<Map<string, BulletRow>> {
  const rows = await pool.query(
    `select * from bullets where owner_id = $1 and purged = false`,
    [ownerId],
  );
  const map = new Map<string, BulletRow>();
  for (const row of rows) {
    map.set(row.id, rowToBulletRow(row));
  }
  return map;
}

export async function loadBranchRows(
  pool: { query: (sql: string, params?: readonly unknown[]) => Promise<QueryResultRow[]> },
  ownerId: string,
  rootId: string,
): Promise<Map<string, BulletRow>> {
  const rows = await pool.query(
    `with recursive branch as (
       select * from bullets where id = $1 and owner_id = $2 and purged = false
       union all
       select b.* from bullets b join branch on b.parent_id = branch.id where b.purged = false
     )
     select * from branch`,
    [rootId, ownerId],
  );
  const map = new Map<string, BulletRow>();
  for (const row of rows) {
    map.set(row.id, rowToBulletRow(row));
  }
  return map;
}

export function isTrashed(row: BulletRow, now: number, trashSeconds: number): boolean {
  if (row.purged) return true;
  if (row.trashedAt === null) return false;
  return now - row.trashedAt >= trashSeconds;
}

export function childRows(rows: Map<string, BulletRow>, parentId: string | null): BulletRow[] {
  const out: BulletRow[] = [];
  for (const row of rows.values()) {
    if (row.parentId === parentId) out.push(row);
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

export function rowDepth(rows: Map<string, BulletRow>, row: BulletRow): number {
  let depth = 0;
  let current: BulletRow | undefined = row;
  const seen = new Set<string>();
  while (current?.parentId !== null && current?.parentId !== undefined) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = rows.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function isDescendantPlacement(
  rows: Map<string, BulletRow>,
  candidateParentId: string,
  originalId: string,
): boolean {
  const original = rows.get(originalId);
  if (!original) return false;
  let currentId: string | null = candidateParentId;
  const seen = new Set<string>();
  while (currentId !== null) {
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    if (currentId === originalId) return true;
    const row = rows.get(currentId);
    if (!row) return false;
    if (row.originalId === originalId) return true;
    currentId = row.parentId;
  }
  return false;
}

export function branchIds(
  rows: Map<string, BulletRow>,
  rootId: string,
): Set<string> {
  const set = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const row of rows.values()) {
      if (row.parentId === id && !set.has(row.id)) {
        set.add(row.id);
        stack.push(row.id);
      }
    }
  }
  return set;
}

export function resolveOriginal(rows: Map<string, BulletRow>, placementId: string): BulletRow | undefined {
  const row = rows.get(placementId);
  if (!row) return undefined;
  if (row.originalId === null) return row;
  return rows.get(row.originalId);
}

export interface ScopeResult {
  ok: boolean;
  view: OutlineRead | null;
  reason: 'not_found' | null;
  isCollaborator: boolean;
  collaboratorRootId: string | null;
}

export interface ViewOrderEntry {
  placement: BulletRow;
  original: BulletRow;
  placeholder: boolean;
  depth: number;
}

export function viewOrder(
  rows: Map<string, BulletRow>,
  rootId: string | null,
  now: number,
  trashSeconds: number,
): ViewOrderEntry[] {
  const out: ViewOrderEntry[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = childRows(rows, parentId).filter(
      (r) => !isTrashed(r, now, trashSeconds),
    );
    for (const child of children) {
      const original = child.originalId ? rows.get(child.originalId) ?? child : child;
      const placeholder =
        child.originalId !== null &&
        (original.trashedAt !== null || original.purged || isTrashed(original, now, trashSeconds));
      out.push({ placement: child, original, placeholder, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

export function placementDepth(rows: Map<string, BulletRow>, id: string): number {
  let depth = 0;
  let current = rows.get(id);
  const seen = new Set<string>();
  while (current && current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = rows.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function checkDepth(rows: Map<string, BulletRow>, bulletId: string, newParentId: string | null, config: Config): boolean {
  if (newParentId === null) return true;
  const parentDepth = placementDepth(rows, newParentId);
  const subtree = branchIds(rows, bulletId);
  let maxExtra = 0;
  for (const id of subtree) {
    const depthInside = placementDepth(rows, id) - placementDepth(rows, bulletId);
    if (depthInside > maxExtra) maxExtra = depthInside;
  }
  return parentDepth + 1 + maxExtra < config.maxDepth;
}

export function checkInside(
  rows: Map<string, BulletRow>,
  bulletId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return true;
  const row = rows.get(bulletId);
  if (!row) return false;
  const originalId = row.originalId ?? bulletId;
  return !isDescendantPlacement(rows, newParentId, originalId);
}

export interface MoveOutcome {
  ok: boolean;
  code?: 'no_previous_sibling' | 'at_top' | 'at_first' | 'at_last' | 'inside_itself' | 'too_deep';
}

export function checkMove(
  rows: Map<string, BulletRow>,
  bulletId: string,
  op: 'indent' | 'outdent' | 'up' | 'down',
  collaboratorRootId: string | null,
  config: Config,
): MoveOutcome {
  const row = rows.get(bulletId);
  if (!row) return { ok: false, code: 'at_first' };
  const siblings = childRows(rows, row.parentId);
  const index = siblings.findIndex((s) => s.id === bulletId);
  if (op === 'indent') {
    if (index <= 0) return { ok: false, code: 'no_previous_sibling' };
    const previous = siblings[index - 1] as BulletRow;
    if (!checkDepth(rows, bulletId, previous.id, config)) return { ok: false, code: 'too_deep' };
    if (!checkInside(rows, bulletId, previous.id)) return { ok: false, code: 'inside_itself' };
    return { ok: true };
  }
  if (op === 'outdent') {
    if (row.parentId === null) return { ok: false, code: 'at_top' };
    if (collaboratorRootId !== null && row.parentId === collaboratorRootId) {
      return { ok: false, code: 'at_top' };
    }
    if (!checkDepth(rows, bulletId, rows.get(row.parentId)?.parentId ?? null, config)) {
      return { ok: false, code: 'too_deep' };
    }
    return { ok: true };
  }
  if (op === 'up') {
    if (index > 0) return { ok: true };
    const parent = row.parentId ? rows.get(row.parentId) : undefined;
    if (!parent) return { ok: false, code: 'at_first' };
    if (collaboratorRootId !== null && parent.id === collaboratorRootId) {
      return { ok: false, code: 'at_first' };
    }
    const parentSiblings = childRows(rows, parent.parentId);
    const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
    if (parentIndex <= 0) return { ok: false, code: 'at_first' };
    const target = parentSiblings[parentIndex - 1] as BulletRow;
    if (!checkDepth(rows, bulletId, target.id, config)) return { ok: false, code: 'too_deep' };
    if (!checkInside(rows, bulletId, target.id)) return { ok: false, code: 'inside_itself' };
    return { ok: true };
  }
  if (op === 'down') {
    if (index < siblings.length - 1) return { ok: true };
    const parent = row.parentId ? rows.get(row.parentId) : undefined;
    if (!parent) return { ok: false, code: 'at_last' };
    if (collaboratorRootId !== null && parent.id === collaboratorRootId) {
      return { ok: false, code: 'at_last' };
    }
    const parentSiblings = childRows(rows, parent.parentId);
    const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
    if (parentIndex === parentSiblings.length - 1 || parentIndex < 0) {
      return { ok: false, code: 'at_last' };
    }
    const target = parentSiblings[parentIndex + 1] as BulletRow;
    if (!checkDepth(rows, bulletId, target.id, config)) return { ok: false, code: 'too_deep' };
    if (!checkInside(rows, bulletId, target.id)) return { ok: false, code: 'inside_itself' };
    return { ok: true };
  }
  return { ok: true };
}

export function errorFromMove(outcome: MoveOutcome): never {
  const code = outcome.code ?? 'at_first';
  const messages: Record<string, string> = {
    no_previous_sibling: "Can't indent: there is no bullet above it at this level.",
    too_deep: `Can't indent: an outline goes at most ${40} levels deep.`,
    at_top: "Can't outdent: it is already at the top level.",
    at_first: "Can't move up: it is already first.",
    at_last: "Can't move down: it is already last.",
    inside_itself: "Can't place a bullet inside itself.",
  };
  throw new ApiError(409, { error: code, message: messages[code] ?? '' });
}

export function normalizePositions(rows: BulletRow[]): void {
  for (let i = 0; i < rows.length; i += 1) {
    rows[i]!.position = i;
  }
}
