import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError } from './store.js';
import type { Account, BulletRow, UndoStepKind } from '../domain/types.js';
import { latestStep, removeStep, pushRedo, popRedo, peekRedo, type RecordedStep } from './undo.js';
import {
  childRows,
  isTrashed,
  placementDepth,
} from '../domain/tree.js';
import { loadOwnedRows, type OutlineScope } from './outline-service.js';
import { recordStep } from './undo.js';
import { rowToBulletRow } from './store.js';
import { toBulletView } from '../domain/text.js';

interface MoveUndoData {
  bulletId: string;
  before: { parentId: string | null; index: number };
  after: { parentId: string | null; index: number };
}

interface TextUndoData {
  bulletId: string;
  before: string;
  after: string;
  revisionBefore: number;
}

interface CompletionUndoData {
  bulletId: string;
  before: boolean;
}

interface NewBulletUndoData {
  bulletId: string;
}

interface MirrorUndoData {
  copyId: string;
}

interface CopyDeleteUndoData {
  kind: 'copy';
  copyId: string;
  originalId: string;
  parentId: string | null;
  position: number;
}

interface OriginalDeleteUndoData {
  kind: 'original';
  bulletId: string;
  snapshot: BranchSnapshot;
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

export interface UndoOutcome {
  step: UndoStepKind;
  bulletId: string;
  seq: number;
  bullets: Record<string, unknown>[];
  removed: string[];
}

export interface UndoContext {
  pool: Pool;
  config: Config;
  account: Account;
  scope: OutlineScope;
  rows: Map<string, BulletRow>;
}

async function persist(ctx: UndoContext, row: BulletRow): Promise<void> {
  await ctx.pool.query(
    `update bullets set parent_id=$2, position=$3, text=$4, completed=$5, collapsed=$6,
     date=$7, tags=$8, mentions=$9, revision=$10, trashed_at=$11, original_id=$12
     where id=$1`,
    [
      row.id, row.parentId, row.position, row.text, row.completed, row.collapsed,
      row.date, row.tags, row.mentions, row.revision, row.trashedAt, row.originalId,
    ],
  );
}

async function persistPositions(ctx: UndoContext, parentId: string | null): Promise<void> {
  const siblings = childRows(ctx.rows, parentId);
  for (let i = 0; i < siblings.length; i += 1) {
    const row = siblings[i] as BulletRow;
    if (row.position !== i) {
      row.position = i;
      await persist(ctx, row);
    }
  }
}

async function reload(ctx: UndoContext): Promise<void> {
  ctx.rows = await loadOwnedRows(ctx.pool, ctx.scope.ownerId);
}

async function nextSeqUndo(ctx: UndoContext): Promise<number> {
  const rows = await ctx.pool.query(
    `update outline_seq set seq = seq + 1 where owner_id = $1 returning seq`,
    [ctx.scope.ownerId],
  );
  return Number(rows.rows[0]?.seq ?? 0);
}

async function changedViews(ctx: UndoContext, ids: string[]): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const row = ctx.rows.get(id);
    if (!row || isTrashed(row, now, ctx.config.trashSeconds)) continue;
    const originalId = row.originalId ?? row.id;
    const original = ctx.rows.get(originalId) ?? row;
    const placeholder = row.originalId !== null && (original.trashedAt !== null || isTrashed(original, now, ctx.config.trashSeconds));
    const childCount = childRows(ctx.rows, row.id).filter((r) => !isTrashed(r, now, ctx.config.trashSeconds)).length;
    out.push(toBulletView(row, placementDepth(ctx.rows, row.id), placeholder, childCount) as Record<string, unknown>);
  }
  return out;
}

export async function performUndo(ctx: UndoContext): Promise<UndoOutcome> {
  const step = await latestStep(ctx.pool, ctx.account.id);
  if (!step) {
    throw new ApiError(409, { error: 'nothing_to_undo', message: 'Nothing more to undo.' });
  }
  const outcome = await applyStep(ctx, step, false);
  await removeStep(ctx.pool, step.id);
  await pushRedo(ctx.pool, ctx.config, ctx.account.id, step);
  return outcome;
}

export async function performRedo(ctx: UndoContext): Promise<UndoOutcome> {
  const step = await peekRedo(ctx.pool, ctx.account.id);
  if (!step) {
    throw new ApiError(409, { error: 'nothing_to_redo', message: 'Nothing more to redo.' });
  }
  const popped = (await popRedo(ctx.pool, ctx.account.id)) as RecordedStep;
  const outcome = await applyStep(ctx, popped, true);
  const inverse = inverseData(popped);
  await recordStep(ctx.pool, ctx.config, ctx.account.id, popped.kind, inverse);
  return outcome;
}

function inverseData(step: RecordedStep): Record<string, unknown> {
  const data = step.data;
  if (step.kind === 'move' || step.kind === 'indent' || step.kind === 'outdent') {
    const d = data as unknown as MoveUndoData;
    return { bulletId: d.bulletId, before: d.after, after: d.before };
  }
  if (step.kind === 'text edit') {
    const d = data as unknown as TextUndoData;
    return { bulletId: d.bulletId, before: d.after, after: d.before, revisionBefore: d.revisionBefore + 2 };
  }
  if (step.kind === 'completion') {
    const d = data as unknown as CompletionUndoData;
    return { bulletId: d.bulletId, before: !d.before };
  }
  return data;
}

async function applyStep(ctx: UndoContext, step: RecordedStep, redoing: boolean): Promise<UndoOutcome> {
  const data = step.data;
  switch (step.kind) {
    case 'new bullet': {
      const d = data as unknown as NewBulletUndoData;
      const row = ctx.rows.get(d.bulletId);
      if (row) {
        await ctx.pool.query(`delete from bullets where id = $1`, [d.bulletId]);
        ctx.rows.delete(d.bulletId);
        await persistPositions(ctx, row.parentId);
      }
      const seq = await nextSeqUndo(ctx);
      return { step: 'new bullet', bulletId: d.bulletId, seq, bullets: [], removed: [d.bulletId] };
    }
    case 'text edit': {
      const d = data as unknown as TextUndoData;
      const row = ctx.rows.get(d.bulletId);
      if (!row) throw new ApiError(404, { error: 'not_found' });
      const changedText = redoing ? d.after : d.before;
      const revisionBefore = redoing ? (d.revisionBefore ?? row.revision - 1) + 2 : (d.revisionBefore ?? row.revision - 1);
      row.text = changedText;
      row.revision = Math.max(1, revisionBefore);
      await persist(ctx, row);
      const seq = await nextSeqUndo(ctx);
      const views = await changedViews(ctx, [d.bulletId]);
      return { step: 'text edit', bulletId: d.bulletId, seq, bullets: views, removed: [] };
    }
    case 'completion': {
      const d = data as unknown as CompletionUndoData;
      const row = ctx.rows.get(d.bulletId);
      if (!row) throw new ApiError(404, { error: 'not_found' });
      row.completed = redoing ? !d.before : d.before;
      await persist(ctx, row);
      const seq = await nextSeqUndo(ctx);
      const views = await changedViews(ctx, [d.bulletId]);
      return { step: 'completion', bulletId: d.bulletId, seq, bullets: views, removed: [] };
    }
    case 'move':
    case 'indent':
    case 'outdent': {
      const d = data as unknown as MoveUndoData;
      const row = ctx.rows.get(d.bulletId);
      if (!row) throw new ApiError(404, { error: 'not_found' });
      const target = redoing ? d.after : d.before;
      if (target.parentId !== null) {
        const parent = ctx.rows.get(target.parentId);
        if (!parent || (parent.trashedAt !== null)) {
          throw new ApiError(409, { error: 'origin_gone', message: "Can't undo: the place it came from was deleted." });
        }
      }
      const oldParentId = row.parentId;
      row.parentId = target.parentId;
      const siblings = childRows(ctx.rows, target.parentId).filter((s) => s.id !== row.id);
      row.position = Math.min(target.index, siblings.length);
      await persist(ctx, row);
      await persistPositions(ctx, oldParentId);
      await persistPositions(ctx, target.parentId);
      const seq = await nextSeqUndo(ctx);
      const views = await changedViews(ctx, [d.bulletId]);
      return { step: step.kind, bulletId: d.bulletId, seq, bullets: views, removed: [] };
    }
    case 'mirror': {
      const d = data as unknown as MirrorUndoData;
      const row = ctx.rows.get(d.copyId);
      if (row) {
        await ctx.pool.query(`delete from bullets where id = $1`, [d.copyId]);
        ctx.rows.delete(d.copyId);
        await persistPositions(ctx, row.parentId);
      }
      const seq = await nextSeqUndo(ctx);
      return { step: 'mirror', bulletId: d.copyId, seq, bullets: [], removed: [d.copyId] };
    }
    case 'delete': {
      const d = data as unknown as CopyDeleteUndoData | OriginalDeleteUndoData;
      if (d.kind === 'copy') {
        const copy = d as CopyDeleteUndoData;
        await ctx.pool.query(
          `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
           values ($1,$2,$3,$4,$5,'',false,false,null,'{}','{}',1,null,false,$6)
           on conflict (id) do nothing`,
          [copy.copyId, ctx.scope.ownerId, copy.originalId, copy.parentId, copy.position, Date.now()],
        );
        await reload(ctx);
        await persistPositions(ctx, copy.parentId);
        const seq = await nextSeqUndo(ctx);
        const views = await changedViews(ctx, [copy.copyId]);
        return { step: 'delete', bulletId: copy.copyId, seq, bullets: views, removed: [] };
      }
      const original = d as OriginalDeleteUndoData;
      await restoreSnapshot(ctx, original.snapshot);
      await reload(ctx);
      const seq = await nextSeqUndo(ctx);
      const ids = collectSnapshotIds(original.snapshot);
      const views = await changedViews(ctx, ids);
      return { step: 'delete', bulletId: original.bulletId, seq, bullets: views, removed: [] };
    }
  }
}

function collectSnapshotIds(snapshot: BranchSnapshot): string[] {
  const ids = [snapshot.id];
  for (const child of snapshot.children) {
    ids.push(...collectSnapshotIds(child));
  }
  return ids;
}

async function restoreSnapshot(ctx: UndoContext, snapshot: BranchSnapshot): Promise<void> {
  const existing = await ctx.pool.query(`select * from bullets where id = $1`, [snapshot.id]);
  if (existing.rows.length === 0) {
    await insertSnapshotRow(ctx, snapshot, snapshot.parentId, snapshot.position);
  } else {
    const row = rowToBulletRow(existing.rows[0] as never);
    row.parentId = snapshot.parentId;
    row.position = snapshot.position;
    row.text = snapshot.text;
    row.completed = snapshot.completed;
    row.collapsed = snapshot.collapsed;
    row.date = snapshot.date;
    row.tags = snapshot.tags;
    row.mentions = snapshot.mentions;
    row.revision = snapshot.revision;
    row.trashedAt = null;
    row.originalId = snapshot.originalId;
    await persist(ctx, row);
  }
  for (const child of snapshot.children) {
    await restoreSnapshot(ctx, child);
  }
}

async function insertSnapshotRow(ctx: UndoContext, snapshot: BranchSnapshot, parentId: string | null, position: number): Promise<void> {
  await ctx.pool.query(
    `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,false,$13)
     on conflict (id) do update set parent_id = excluded.parent_id, position = excluded.position,
       text = excluded.text, completed = excluded.completed, collapsed = excluded.collapsed,
       date = excluded.date, tags = excluded.tags, mentions = excluded.mentions,
       revision = excluded.revision, trashed_at = null, original_id = excluded.original_id`,
    [
      snapshot.id, ctx.scope.ownerId, snapshot.originalId, parentId, position, snapshot.text,
      snapshot.completed, snapshot.collapsed, snapshot.date, snapshot.tags, snapshot.mentions,
      snapshot.revision, Date.now(),
    ],
  );
  for (const child of snapshot.children) {
    await insertSnapshotRow(ctx, child, snapshot.id, child.position);
  }
}
