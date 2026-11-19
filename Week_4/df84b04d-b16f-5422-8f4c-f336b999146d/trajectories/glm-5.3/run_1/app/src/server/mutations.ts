import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError, newId, rowToBulletRow, nextSeq } from './store.js';
import type { Account, BulletRow, UndoStepKind } from '../domain/types.js';
import {
  branchIds,
  childRows,
  isTrashed,
  checkMove,
  viewOrder,
  placementDepth,
} from '../domain/tree.js';
import {
  loadOwnedRows,
  loadScope,
  type OutlineScope,
} from './outline-service.js';
import { toBulletView, extractMentions, extractTags, rewriteDates } from '../domain/text.js';
import { recordStep } from './undo.js';

export interface MutationResult {
  bullet: BulletRow | null;
  bullets: Record<string, unknown>[];
  removed: string[];
  seq: number;
}

export interface MutationContext {
  pool: Pool;
  config: Config;
  today: string;
  account: Account;
  scope: OutlineScope;
  rows: Map<string, BulletRow>;
}

async function persist(ctx: MutationContext, row: BulletRow): Promise<void> {
  await ctx.pool.query(
    `update bullets set parent_id=$2, position=$3, text=$4, completed=$5, collapsed=$6,
     date=$7, tags=$8, mentions=$9, revision=$10, trashed_at=$11, original_id=$12
     where id=$1`,
    [
      row.id,
      row.parentId,
      row.position,
      row.text,
      row.completed,
      row.collapsed,
      row.date,
      row.tags,
      row.mentions,
      row.revision,
      row.trashedAt,
      row.originalId,
    ],
  );
}

async function persistPositions(ctx: MutationContext, parentId: string | null): Promise<void> {
  const siblings = childRows(ctx.rows, parentId);
  for (let i = 0; i < siblings.length; i += 1) {
    const row = siblings[i] as BulletRow;
    if (row.position !== i) {
      row.position = i;
      await persist(ctx, row);
    }
  }
}

async function reloadRowsLocal(ctx: MutationContext): Promise<void> {
  if (ctx.scope.isCollaborator && ctx.scope.collaboratorRootId) {
    const result = await ctx.pool.query(
      `with recursive branch as (
         select * from bullets where id = $1 and owner_id = $2 and purged = false
         union all
         select b.* from bullets b join branch on b.parent_id = branch.id where b.purged = false
       ) select * from branch`,
      [ctx.scope.collaboratorRootId, ctx.scope.ownerId],
    );
    ctx.rows = new Map(result.rows.map((r) => [String(r.id), rowToBulletRow(r)]));
  } else {
    ctx.rows = await loadOwnedRows(ctx.pool, ctx.scope.ownerId);
  }
}

export async function withRows(
  pool: Pool,
  config: Config,
  account: Account,
  rootId: string | null,
): Promise<MutationContext> {
  const now = Date.now();
  const loaded = await loadScope(pool, account, rootId, now, config);
  return { pool, config, today: todayFor2(config), account, scope: loaded.scope, rows: loaded.rows };
}

export async function createBullet(
  ctx: MutationContext,
  parentId: string | null,
  afterId: string | null,
  text: string,
  recordHistoryFor: Account | null,
): Promise<MutationResult> {
  const now = Date.now();
  if (parentId !== null) {
    assertOpenable(ctx, parentId);
  }
  if (afterId !== null) {
    assertOpenable(ctx, afterId);
    const after = ctx.rows.get(afterId);
    if (!after) throw new ApiError(404, { error: 'not_found' });
    if (after.parentId !== parentId) throw new ApiError(422, { errors: { afterId: 'afterId must be a child of parentId' } });
  }
  if (parentId !== null) {
    const parentDepth = placementDepth(ctx.rows, parentId);
    if (parentDepth + 1 >= ctx.config.maxDepth) {
      throw new ApiError(409, { error: 'too_deep', message: `Can't indent: an outline goes at most ${ctx.config.maxDepth} levels deep.` });
    }
  }
  const siblings = childRows(ctx.rows, parentId).filter((r) => !isTrashed(r, now, ctx.config.trashSeconds));
  let index = siblings.length;
  if (afterId !== null) {
    const after = ctx.rows.get(afterId);
    if (after) {
      index = siblings.findIndex((s) => s.id === afterId) + 1;
    }
  }
  const { canonicalText, date } = rewriteDates(text, ctx.today);
  const bullet: BulletRow = {
    id: newId(),
    ownerId: ctx.scope.ownerId,
    originalId: null,
    parentId,
    position: index,
    text: canonicalText,
    completed: false,
    collapsed: false,
    date,
    tags: extractTags(canonicalText),
    mentions: extractMentions(canonicalText),
    revision: 1,
    trashedAt: null,
    purged: false,
    createdAt: now,
  };
  await ctx.pool.query(
    `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [bullet.id, bullet.ownerId, null, parentId, index, bullet.text, false, false, bullet.date, bullet.tags, bullet.mentions, 1, null, false, now],
  );
  for (const sibling of siblings.slice(index)) {
    await ctx.pool.query(`update bullets set position = position + 1 where id = $1`, [sibling.id]);
    sibling.position += 1;
  }
  ctx.rows.set(bullet.id, bullet);
  if (recordHistoryFor) {
    await recordStep(ctx.pool, ctx.config, recordHistoryFor.id, 'new bullet', { bulletId: bullet.id });
  }
  return finish(ctx, [bullet], []);
}

export async function patchBullet(
  ctx: MutationContext,
  bulletId: string,
  patch: { text?: unknown; revision?: unknown; completed?: unknown; collapsed?: unknown },
): Promise<MutationResult> {
  assertOpenable(ctx, bulletId);
  const placement = ctx.rows.get(bulletId) as BulletRow;
  const originalId = placement.originalId ?? bulletId;
  const original = ctx.rows.get(originalId) as BulletRow;
  const changed: BulletRow[] = [];
  if (patch.collapsed !== undefined) {
    placement.collapsed = Boolean(patch.collapsed);
    await persist(ctx, placement);
    changed.push(placement);
  }
  if (patch.completed !== undefined) {
    const next = Boolean(patch.completed);
    if (original.completed !== next) {
      original.completed = next;
      original.revision += 1;
      await persist(ctx, original);
      changed.push(original);
      if (placement.id !== original.id) changed.push(placement);
    }
  }
  if (patch.text !== undefined) {
    const text = patch.text;
    if (typeof text !== 'string') {
      throw new ApiError(422, { errors: { text: 'Send a JSON object.' } });
    }
    if (text.length > ctx.config.bulletMaxChars) {
      throw new ApiError(422, { errors: { text: `A bullet holds at most ${ctx.config.bulletMaxChars} characters.` } });
    }
    if (patch.revision === undefined) {
      throw new ApiError(422, { errors: { revision: 'Send the revision you last saw.' } });
    }
    const claimed = Number(patch.revision);
    if (!Number.isInteger(claimed)) {
      throw new ApiError(422, { errors: { revision: 'Send the revision you last saw.' } });
    }
    if (claimed < original.revision) {
      const editor = await lastEditorName(ctx, original.id);
      throw new ApiError(409, {
        error: 'stale_revision',
        message: `${editor} changed this bullet first. Their text is shown; your edit was not saved.`,
        current: { text: original.text, revision: original.revision },
        editor: { name: editor },
      });
    }
    const { canonicalText, date } = rewriteDates(text, ctx.today);
    original.text = canonicalText;
    original.date = date;
    original.tags = extractTags(canonicalText);
    original.mentions = extractMentions(canonicalText);
    original.revision += 1;
    original.trashedAt = original.trashedAt;
    await persist(ctx, original);
    changed.push(original);
    if (placement.id !== original.id) changed.push(placement);
  }
  return finish(ctx, changed, []);
}

async function lastEditorName(ctx: MutationContext, bulletId: string): Promise<string> {
  const rows = await ctx.pool.query(
    `select a.name from bullets b join accounts a on a.id = b.owner_id where b.id = $1`,
    [bulletId],
  );
  return rows.rows[0] ? String(rows.rows[0].name) : ctx.account.name;
}

export async function moveBullet(
  ctx: MutationContext,
  bulletId: string,
  move: { op?: unknown; parentId?: unknown; index?: unknown },
  recordFor: Account | null,
): Promise<MutationResult> {
  assertOpenable(ctx, bulletId);
  const row = ctx.rows.get(bulletId) as BulletRow;
  if (move.op === undefined && move.parentId === undefined) {
    throw new ApiError(422, { errors: { op: 'Send a move to apply.' } });
  }
  if (move.parentId !== undefined) {
    return explicitMove(ctx, row, move.parentId, move.index, recordFor);
  }
  const op = String(move.op);
  if (op !== 'indent' && op !== 'outdent' && op !== 'up' && op !== 'down') {
    throw new ApiError(422, { errors: { op: 'Send indent, outdent, up or down.' } });
  }
  const outcome = checkMove(ctx.rows, bulletId, op, ctx.scope.collaboratorRootId, ctx.config);
  if (!outcome.ok) {
    throwMoveError(outcome, ctx.config);
  }
  const oldParentId = row.parentId;
  const siblings = childRows(ctx.rows, oldParentId);
  const oldIndex = siblings.findIndex((s) => s.id === bulletId);
  const before = { parentId: oldParentId, index: oldIndex };
  if (op === 'indent') {
    const previous = siblings[oldIndex - 1] as BulletRow;
    previous.collapsed = false;
    row.parentId = previous.id;
    row.position = childRows(ctx.rows, previous.id).length;
    await persist(ctx, previous);
    await persist(ctx, row);
    await persistPositions(ctx, oldParentId);
  } else if (op === 'outdent') {
    const parent = ctx.rows.get(row.parentId as string) as BulletRow;
    const parentSiblings = childRows(ctx.rows, parent.parentId);
    const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
    row.parentId = parent.parentId;
    row.position = parentIndex + 1;
    await persist(ctx, row);
    await persistPositions(ctx, parent.id);
    await persistPositions(ctx, parent.parentId);
  } else if (op === 'up') {
    if (oldIndex > 0) {
      const previous = siblings[oldIndex - 1] as BulletRow;
      previous.position = oldIndex;
      row.position = oldIndex - 1;
      await persist(ctx, previous);
      await persist(ctx, row);
    } else {
      const parent = ctx.rows.get(row.parentId as string) as BulletRow;
      const parentSiblings = childRows(ctx.rows, parent.parentId);
      const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
      const target = parentSiblings[parentIndex - 1] as BulletRow;
      target.collapsed = false;
      row.parentId = target.id;
      row.position = childRows(ctx.rows, target.id).length;
      await persist(ctx, target);
      await persist(ctx, row);
      await persistPositions(ctx, oldParentId);
    }
  } else {
    if (oldIndex < siblings.length - 1) {
      const next = siblings[oldIndex + 1] as BulletRow;
      next.position = oldIndex;
      row.position = oldIndex + 1;
      await persist(ctx, next);
      await persist(ctx, row);
    } else {
      const parent = ctx.rows.get(row.parentId as string) as BulletRow;
      const parentSiblings = childRows(ctx.rows, parent.parentId);
      const parentIndex = parentSiblings.findIndex((s) => s.id === parent.id);
      const target = parentSiblings[parentIndex + 1] as BulletRow;
      target.collapsed = false;
      row.parentId = target.id;
      row.position = 0;
      await persist(ctx, target);
      await persist(ctx, row);
      const targetChildren = childRows(ctx.rows, target.id);
      for (let i = 1; i < targetChildren.length; i += 1) {
        const c = targetChildren[i] as BulletRow;
        c.position = i;
        await persist(ctx, c);
      }
      await persistPositions(ctx, oldParentId);
    }
  }
  if (recordFor) {
    const kind: UndoStepKind = op === 'indent' ? 'indent' : op === 'outdent' ? 'outdent' : 'move';
    await recordStep(ctx.pool, ctx.config, recordFor.id, kind, {
      bulletId,
      before,
      after: { parentId: row.parentId, index: row.position },
    });
  }
  return finish(ctx, [row], []);
}

function throwMoveError(outcome: { ok: boolean; code?: string }, config: Config): never {
  const code = outcome.code ?? 'at_first';
  const messages: Record<string, string> = {
    no_previous_sibling: "Can't indent: there is no bullet above it at this level.",
    too_deep: `Can't indent: an outline goes at most ${config.maxDepth} levels deep.`,
    at_top: "Can't outdent: it is already at the top level.",
    at_first: "Can't move up: it is already first.",
    at_last: "Can't move down: it is already last.",
    inside_itself: "Can't place a bullet inside itself.",
  };
  throw new ApiError(409, { error: code, message: messages[code] ?? '' });
}

async function explicitMove(
  ctx: MutationContext,
  row: BulletRow,
  parentId: unknown,
  index: unknown,
  recordFor: Account | null,
): Promise<MutationResult> {
  if (parentId !== null && typeof parentId !== 'string') {
    throw new ApiError(422, { errors: { parentId: 'Send a parent id or null.' } });
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new ApiError(422, { errors: { index: 'Send a position of 0 or more.' } });
  }
  const newParentId = parentId === null ? null : String(parentId);
  if (newParentId !== null) {
    assertOpenable(ctx, newParentId);
    const parent = ctx.rows.get(newParentId);
    if (!parent) throw new ApiError(404, { error: 'not_found' });
    const siblingCount = childRows(ctx.rows, newParentId).length;
    if (index > siblingCount) {
      throw new ApiError(422, { errors: { index: 'Send a position of 0 to ' + siblingCount + '.' } });
    }
    const outcome = checkInsideItself(ctx, row, newParentId);
    if (!outcome) {
      throw new ApiError(409, { error: 'inside_itself', message: "Can't place a bullet inside itself." });
    }
    const parentDepth = placementDepth(ctx.rows, newParentId);
    const subtree = branchIds(ctx.rows, row.id);
    let maxExtra = 0;
    for (const id of subtree) {
      const inside = placementDepth(ctx.rows, id) - placementDepth(ctx.rows, row.id);
      if (inside > maxExtra) maxExtra = inside;
    }
    if (parentDepth + 1 + maxExtra >= ctx.config.maxDepth) {
      throw new ApiError(409, { error: 'too_deep', message: `Can't indent: an outline goes at most ${ctx.config.maxDepth} levels deep.` });
    }
  }
  const before = { parentId: row.parentId, index: row.position };
  const oldParentId = row.parentId;
  const oldSiblings = childRows(ctx.rows, oldParentId).filter((s) => s.id !== row.id);
  row.parentId = newParentId;
  const newSiblings = childRows(ctx.rows, newParentId).filter((s) => s.id !== row.id);
  const finalIndex = Math.min(index, newSiblings.length);
  row.position = finalIndex;
  await persist(ctx, row);
  for (let i = 0; i < oldSiblings.length; i += 1) {
    const s = oldSiblings[i] as BulletRow;
    if (s.position !== i) {
      s.position = i;
      await persist(ctx, s);
    }
  }
  for (let i = 0; i < newSiblings.length; i += 1) {
    const s = newSiblings[i] as BulletRow;
    const target = i < finalIndex ? i : i + 1;
    if (s.position !== target) {
      s.position = target;
      await persist(ctx, s);
    }
  }
  if (recordFor) {
    await recordStep(ctx.pool, ctx.config, recordFor.id, 'move', {
      bulletId: row.id,
      before,
      after: { parentId: row.parentId, index: row.position },
    });
  }
  return finish(ctx, [row], []);
}

function checkInsideItself(ctx: MutationContext, row: BulletRow, newParentId: string): boolean {
  const originalId = row.originalId ?? row.id;
  let currentId: string | null = newParentId;
  const seen = new Set<string>();
  while (currentId !== null) {
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    if (currentId === originalId) return false;
    const current = ctx.rows.get(currentId);
    if (!current) return true;
    if (current.originalId === originalId) return false;
    currentId = current.parentId;
  }
  return true;
}

export async function mirrorBullet(
  ctx: MutationContext,
  bulletId: string,
  target: { parentId?: unknown; index?: unknown },
  recordFor: Account | null,
): Promise<MutationResult> {
  assertOpenable(ctx, bulletId);
  const row = ctx.rows.get(bulletId) as BulletRow;
  const originalId = row.originalId ?? bulletId;
  let parentId: string | null;
  let index: number;
  if (target.parentId !== undefined) {
    if (target.parentId !== null && typeof target.parentId !== 'string') {
      throw new ApiError(422, { errors: { parentId: 'Send a parent id or null.' } });
    }
    parentId = target.parentId === null ? null : String(target.parentId);
    if (parentId !== null) assertOpenable(ctx, parentId);
    if (typeof target.index !== 'number' || !Number.isInteger(target.index)) {
      throw new ApiError(422, { errors: { index: 'Send a position of 0 or more.' } });
    }
    index = target.index;
  } else {
    parentId = row.parentId;
    index = row.position + 1;
  }
  if (parentId !== null) {
    const parent = ctx.rows.get(parentId);
    if (!parent) throw new ApiError(404, { error: 'not_found' });
    const siblingCount = childRows(ctx.rows, parentId).length;
    if (index > siblingCount) {
      throw new ApiError(422, { errors: { index: 'Send a position of 0 to ' + siblingCount + '.' } });
    }
    if (!checkInsideItself(ctx, row, parentId)) {
      throw new ApiError(409, { error: 'inside_itself', message: "Can't place a bullet inside itself." });
    }
    const parentDepth = placementDepth(ctx.rows, parentId);
    const subtree = branchIds(ctx.rows, originalId);
    let maxExtra = 0;
    for (const id of subtree) {
      const inside = placementDepth(ctx.rows, id) - placementDepth(ctx.rows, originalId);
      if (inside > maxExtra) maxExtra = inside;
    }
    if (parentDepth + 1 + maxExtra >= ctx.config.maxDepth) {
      throw new ApiError(409, { error: 'too_deep', message: `Can't indent: an outline goes at most ${ctx.config.maxDepth} levels deep.` });
    }
  }
  const copyId = newId();
  const siblings = childRows(ctx.rows, parentId);
  await ctx.pool.query(
    `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
     values ($1,$2,$3,$4,$5,'',false,false,null,'{}','{}',1,null,false,$6)`,
    [copyId, ctx.scope.ownerId, originalId, parentId, index, Date.now()],
  );
  for (const sibling of siblings.slice(index)) {
    await ctx.pool.query(`update bullets set position = position + 1 where id = $1`, [sibling.id]);
    sibling.position += 1;
  }
  const copy: BulletRow = {
    id: copyId,
    ownerId: ctx.scope.ownerId,
    originalId,
    parentId,
    position: index,
    text: '',
    completed: false,
    collapsed: false,
    date: null,
    tags: [],
    mentions: [],
    revision: 1,
    trashedAt: null,
    purged: false,
    createdAt: Date.now(),
  };
  ctx.rows.set(copyId, copy);
  if (recordFor) {
    await recordStep(ctx.pool, ctx.config, recordFor.id, 'mirror', { copyId });
  }
  return finish(ctx, [copy], []);
}

export async function deleteBullet(
  ctx: MutationContext,
  bulletId: string,
  recordFor: Account | null,
): Promise<{ result: 'trashed' | 'copy_removed'; count: number; seq: number; bullets: Record<string, unknown>[]; removed: string[] }> {
  assertOpenable(ctx, bulletId);
  const row = ctx.rows.get(bulletId) as BulletRow;
  const now = Date.now();
  if (ctx.scope.isCollaborator && ctx.scope.collaboratorRootId === bulletId) {
    throw new ApiError(409, {
      error: 'share_root',
      message: 'The shared bullet stays where its owner put it.',
    });
  }
  if (row.originalId !== null) {
    await ctx.pool.query(`delete from bullets where id = $1`, [bulletId]);
    ctx.rows.delete(bulletId);
    await persistPositions(ctx, row.parentId);
    if (recordFor) {
      await recordStep(ctx.pool, ctx.config, recordFor.id, 'delete', {
        kind: 'copy',
        copyId: bulletId,
        originalId: row.originalId,
        parentId: row.parentId,
        position: row.position,
      });
    }
    return finishDelete(ctx, [], [bulletId], 'copy_removed', 1);
  }
  const ids = branchIds(ctx.rows, bulletId);
  const trashed = [...ids].filter((id) => {
    const r = ctx.rows.get(id);
    return r !== undefined && !isTrashed(r, now, ctx.config.trashSeconds);
  });
  for (const id of trashed) {
    const r = ctx.rows.get(id) as BulletRow;
    r.trashedAt = now;
    await persist(ctx, r);
  }
  await persistPositions(ctx, row.parentId);
  if (recordFor) {
    await recordStep(ctx.pool, ctx.config, recordFor.id, 'delete', {
      kind: 'original',
      bulletId,
      snapshot: snapshotBranch(ctx, bulletId),
    });
  }
  return finishDelete(ctx, [], trashed, 'trashed', trashed.length);
}

interface BranchSnapshot {
  id: string;
  parentId: string | null;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  revision: number;
  originalId: string | null;
  trashedAt: number | null;
  children: BranchSnapshot[];
}

function snapshotBranch(ctx: MutationContext, rootId: string): BranchSnapshot {
  const build = (id: string): BranchSnapshot => {
    const row = ctx.rows.get(id) as BulletRow;
    const children = childRows(ctx.rows, id)
      .filter((c) => c.id !== id)
      .map((c) => build(c.id));
    return {
      id: row.id,
      parentId: row.parentId,
      position: row.position,
      text: row.text,
      completed: row.completed,
      collapsed: row.collapsed,
      date: row.date,
      tags: [...row.tags],
      mentions: [...row.mentions],
      revision: row.revision,
      originalId: row.originalId,
      trashedAt: row.trashedAt,
      children,
    };
  };
  return build(rootId);
}

async function finishDelete(
  ctx: MutationContext,
  bullets: Record<string, unknown>[],
  removed: string[],
  result: 'trashed' | 'copy_removed',
  count: number,
): Promise<{ result: 'trashed' | 'copy_removed'; count: number; seq: number; bullets: Record<string, unknown>[]; removed: string[] }> {
  const seq = await nextSeq(ctx.pool, ctx.scope.ownerId);
  return { result, count, seq, bullets, removed };
}

export function assertOpenable(ctx: MutationContext, bulletId: string): void {
  const row = ctx.rows.get(bulletId);
  if (!row) throw new ApiError(404, { error: 'not_found' });
  if (isTrashed(row, Date.now(), ctx.config.trashSeconds)) {
    throw new ApiError(404, { error: 'not_found' });
  }
}

export async function finish(
  ctx: MutationContext,
  changedRows: BulletRow[],
  removedIds: string[],
): Promise<MutationResult> {
  const seq = await nextSeq(ctx.pool, ctx.scope.ownerId);
  const now = Date.now();
  const bullets: Record<string, unknown>[] = [];
  const entries = viewOrder(ctx.rows, null, now, ctx.config.trashSeconds);
  const depthOf = new Map<string, number>();
  for (const entry of entries) {
    depthOf.set(entry.placement.id, entry.depth);
  }
  for (const row of changedRows) {
    if (isTrashed(row, now, ctx.config.trashSeconds)) continue;
    const originalId = row.originalId ?? row.id;
    const original = ctx.rows.get(originalId) ?? row;
    const placeholder =
      row.originalId !== null && (original.trashedAt !== null || isTrashed(original, now, ctx.config.trashSeconds));
    const childCount = childRows(ctx.rows, row.id).filter((r) => !isTrashed(r, now, ctx.config.trashSeconds)).length;
    const depth = depthOf.get(row.id) ?? 0;
    bullets.push(toBulletView(row, depth, placeholder, childCount) as Record<string, unknown>);
  }
  return { bullet: changedRows[0] ?? null, bullets, removed: removedIds, seq };
}

export { reloadRowsLocal as reloadRows };

function todayFor2(config: Config): string {
  return config.outlineToday ?? new Date().toISOString().slice(0, 10);
}
