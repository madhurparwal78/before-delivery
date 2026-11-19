import type { PoolClient } from 'pg';
import type { StepKind } from '../shared/copy.js';
import { config } from './config.js';
import { conflict, notFound } from './errors.js';
import type { Scope } from './scope.js';
import {
  deleteRows,
  insertRow,
  placeAt,
  readRow,
  renumber,
  restoreRows,
  trashRows,
  writeCompleted,
  writeText,
  type SavedRow,
  type TextFields
} from './rows.js';

interface TextSnapshot extends TextFields {
  revision: number;
}

export type HistoryStep =
  | { kind: 'new bullet'; row: SavedRow; split?: { bulletId: string; before: TextSnapshot; after: TextSnapshot } }
  | { kind: 'text edit'; bulletId: string; before: TextSnapshot; after: TextSnapshot }
  | { kind: 'completion'; bulletId: string; before: boolean; after: boolean; afterRevision: number }
  | { kind: 'delete'; mode: 'trash' | 'copy'; rootId: string; rows: SavedRow[] }
  | {
      kind: 'move' | 'indent' | 'outdent';
      bulletId: string;
      from: { parentId: string | null; position: number };
      to: { parentId: string | null; position: number };
    }
  | { kind: 'mirror'; row: SavedRow };

interface StoredStep {
  id: string;
  kind: StepKind;
  payload: HistoryStep;
}

/** Adds a step to the person's own history, merging consecutive text saves of one bullet. */
export async function pushStep(client: PoolClient, scope: Scope, step: HistoryStep): Promise<void> {
  const userId = scope.viewer.userId;
  await client.query(
    `delete from history_steps where user_id = $1 and owner_id = $2 and undone = true`,
    [userId, scope.ownerId]
  );
  if (step.kind === 'text edit') {
    const newest = await client.query(
      `select id, payload from history_steps
        where user_id = $1 and owner_id = $2 order by id desc limit 1`,
      [userId, scope.ownerId]
    );
    const row = newest.rows[0] as { id: string; payload: HistoryStep } | undefined;
    if (row !== undefined && row.payload.kind === 'text edit' && row.payload.bulletId === step.bulletId) {
      const merged: HistoryStep = { ...row.payload, after: step.after };
      await client.query(`update history_steps set payload = $2 where id = $1`, [
        row.id,
        JSON.stringify(merged)
      ]);
      return;
    }
  }
  await client.query(
    `insert into history_steps (user_id, owner_id, kind, payload) values ($1, $2, $3, $4)`,
    [userId, scope.ownerId, step.kind, JSON.stringify(step)]
  );
  await client.query(
    `delete from history_steps where user_id = $1 and owner_id = $2 and id not in (
       select id from history_steps where user_id = $1 and owner_id = $2
        order by id desc limit $3)`,
    [userId, scope.ownerId, config.undoDepth]
  );
}

async function newestStep(
  client: PoolClient,
  scope: Scope,
  undone: boolean
): Promise<StoredStep | null> {
  const order = undone ? 'asc' : 'desc';
  const result = await client.query(
    `select id, kind, payload from history_steps
      where user_id = $1 and owner_id = $2 and undone = $3 order by id ${order} limit 1`,
    [scope.viewer.userId, scope.ownerId, undone]
  );
  const row = result.rows[0] as { id: string; kind: StepKind; payload: HistoryStep } | undefined;
  return row === undefined ? null : { id: row.id, kind: row.kind, payload: row.payload };
}

async function dropStep(client: PoolClient, id: string): Promise<void> {
  await client.query(`delete from history_steps where id = $1`, [id]);
}

async function markStep(client: PoolClient, id: string, undone: boolean): Promise<void> {
  await client.query(`update history_steps set undone = $2 where id = $1`, [id, undone]);
}

async function editorName(client: PoolClient, userId: string | null): Promise<string> {
  if (userId === null) return 'Someone else';
  const result = await client.query(`select name from users where id = $1`, [userId]);
  return (result.rows[0] as { name: string } | undefined)?.name ?? 'Someone else';
}

interface Applied {
  bulletId: string;
  affected: string[];
  removed: string[];
}

async function restoreText(
  client: PoolClient,
  scope: Scope,
  bulletId: string,
  snapshot: TextSnapshot,
  expectedRevision: number
): Promise<Applied> {
  const row = await readRow(client, bulletId);
  if (row === null) throw notFound();
  if (row.revision !== expectedRevision && row.revisionAuthor !== scope.viewer.userId) {
    throw conflict('edited_since', {}, await editorName(client, row.revisionAuthor));
  }
  await writeText(client, bulletId, snapshot, scope.viewer.userId);
  return { bulletId, affected: [bulletId], removed: [] };
}

async function restoreCompletion(
  client: PoolClient,
  scope: Scope,
  bulletId: string,
  value: boolean,
  expectedRevision: number
): Promise<Applied> {
  const row = await readRow(client, bulletId);
  if (row === null) throw notFound();
  if (row.revision !== expectedRevision && row.revisionAuthor !== scope.viewer.userId) {
    throw conflict('edited_since', {}, await editorName(client, row.revisionAuthor));
  }
  await writeCompleted(client, bulletId, value, scope.viewer.userId);
  return { bulletId, affected: [bulletId], removed: [] };
}

async function moveBack(
  client: PoolClient,
  bulletId: string,
  target: { parentId: string | null; position: number }
): Promise<Applied> {
  const row = await readRow(client, bulletId);
  if (row === null) throw notFound();
  if (target.parentId !== null) {
    const parent = await readRow(client, target.parentId);
    if (parent === null) throw conflict('origin_gone');
  }
  await placeAt(client, row, target.parentId, target.position);
  return { bulletId, affected: [bulletId], removed: [] };
}

async function removeCreated(client: PoolClient, row: SavedRow): Promise<string[]> {
  const result = await client.query(
    `with recursive branch as (
       select id from bullets where id = $1
       union all
       select b.id from bullets b join branch on b.parent_id = branch.id
     ) select id from branch`,
    [row.id]
  );
  const ids = (result.rows as Array<{ id: string }>).map((entry) => entry.id);
  const current = await readRow(client, row.id);
  if (current !== null) {
    await client.query(
      `update bullets set position = position - 1
        where owner_id = $1 and parent_id is not distinct from $2 and trashed_at is null and position > $3`,
      [current.ownerId, current.parentId, current.position]
    );
  }
  await deleteRows(client, ids);
  return ids;
}

/** Takes back one step of the person's own history. */
export async function undoStep(
  client: PoolClient,
  scope: Scope
): Promise<{ kind: StepKind; applied: Applied }> {
  const stored = await newestStep(client, scope, false);
  if (stored === null) throw conflict('nothing_to_undo');
  const step = stored.payload;
  try {
    const applied = await undoOne(client, scope, step);
    await markStep(client, stored.id, true);
    return { kind: stored.kind, applied };
  } catch (error) {
    await dropStep(client, stored.id);
    throw error;
  }
}

async function undoOne(client: PoolClient, scope: Scope, step: HistoryStep): Promise<Applied> {
  switch (step.kind) {
    case 'new bullet': {
      const removed = await removeCreated(client, step.row);
      if (step.split !== undefined) {
        await restoreText(
          client,
          scope,
          step.split.bulletId,
          step.split.before,
          step.split.after.revision
        );
        return { bulletId: step.split.bulletId, affected: [step.split.bulletId], removed };
      }
      return { bulletId: step.row.id, affected: [], removed };
    }
    case 'text edit':
      return restoreText(client, scope, step.bulletId, step.before, step.after.revision);
    case 'completion':
      return restoreCompletion(client, scope, step.bulletId, step.before, step.afterRevision);
    case 'delete': {
      if (step.mode === 'copy') {
        const row = step.rows[0]!;
        await insertRow(client, row);
        return { bulletId: row.id, affected: [row.id], removed: [] };
      }
      const ids = step.rows.map((row) => row.id);
      const alive = await client.query(`select id from bullets where id = any($1::text[])`, [ids]);
      if ((alive.rows as Array<{ id: string }>).length !== ids.length) throw conflict('nothing_to_undo');
      await restoreRows(client, ids);
      const root = step.rows.find((row) => row.id === step.rootId)!;
      const row = await readRow(client, root.id);
      if (row !== null) {
        if (root.parentId !== null && (await readRow(client, root.parentId)) === null) {
          throw conflict('origin_gone');
        }
        await client.query(
          `update bullets set position = position + 1
            where owner_id = $1 and parent_id is not distinct from $2 and trashed_at is null
              and position >= $3 and id <> $4`,
          [root.ownerId, root.parentId, root.position, root.id]
        );
        await client.query(`update bullets set parent_id = $2, position = $3 where id = $1`, [
          root.id,
          root.parentId,
          root.position
        ]);
        await renumber(client, root.ownerId, root.parentId);
      }
      const affected = ids.concat(
        ...(await Promise.all(
          ids.map(async (id) => {
            const copies = await client.query(`select id from bullets where mirror_of = $1`, [id]);
            return (copies.rows as Array<{ id: string }>).map((entry) => entry.id);
          })
        ))
      );
      return { bulletId: step.rootId, affected, removed: [] };
    }
    case 'move':
    case 'indent':
    case 'outdent':
      return moveBack(client, step.bulletId, step.from);
    case 'mirror': {
      const removed = await removeCreated(client, step.row);
      return { bulletId: step.row.id, affected: [], removed };
    }
  }
}

/** Reapplies the most recently undone step. */
export async function redoStep(
  client: PoolClient,
  scope: Scope
): Promise<{ kind: StepKind; applied: Applied }> {
  const stored = await newestStep(client, scope, true);
  if (stored === null) throw conflict('nothing_to_redo');
  const step = stored.payload;
  try {
    const applied = await redoOne(client, scope, step);
    await markStep(client, stored.id, false);
    return { kind: stored.kind, applied };
  } catch (error) {
    await dropStep(client, stored.id);
    throw error;
  }
}

async function redoOne(client: PoolClient, scope: Scope, step: HistoryStep): Promise<Applied> {
  switch (step.kind) {
    case 'new bullet': {
      await insertRow(client, step.row);
      if (step.split !== undefined) {
        await restoreText(
          client,
          scope,
          step.split.bulletId,
          step.split.after,
          step.split.before.revision
        );
      }
      return { bulletId: step.row.id, affected: [step.row.id, ...(step.split ? [step.split.bulletId] : [])], removed: [] };
    }
    case 'text edit':
      return restoreText(client, scope, step.bulletId, step.after, step.before.revision);
    case 'completion':
      return restoreCompletion(client, scope, step.bulletId, step.after, step.afterRevision);
    case 'delete': {
      if (step.mode === 'copy') {
        const row = step.rows[0]!;
        const current = await readRow(client, row.id);
        if (current !== null) {
          await client.query(
            `update bullets set position = position - 1
              where owner_id = $1 and parent_id is not distinct from $2 and trashed_at is null and position > $3`,
            [current.ownerId, current.parentId, current.position]
          );
        }
        await deleteRows(client, [row.id]);
        return { bulletId: row.id, affected: [], removed: [row.id] };
      }
      const ids = step.rows.map((row) => row.id);
      await trashRows(client, ids, config.trashSeconds);
      const root = step.rows.find((row) => row.id === step.rootId)!;
      await client.query(
        `update bullets set position = position - 1
          where owner_id = $1 and parent_id is not distinct from $2 and trashed_at is null and position > $3`,
        [root.ownerId, root.parentId, root.position]
      );
      const copies = await client.query(
        `select id from bullets where mirror_of = any($1::text[]) and trashed_at is null`,
        [ids]
      );
      return {
        bulletId: step.rootId,
        affected: (copies.rows as Array<{ id: string }>).map((entry) => entry.id),
        removed: ids
      };
    }
    case 'move':
    case 'indent':
    case 'outdent':
      return moveBack(client, step.bulletId, step.to);
    case 'mirror': {
      await insertRow(client, step.row);
      return { bulletId: step.row.id, affected: [step.row.id], removed: [] };
    }
  }
}

/** Drops the steps that point at rows the purge has removed. */
export async function forgetPurgedSteps(client: PoolClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query(
    `delete from history_steps where exists (
       select 1 from unnest($1::text[]) as purged(id)
        where history_steps.payload::text like '%' || purged.id || '%')`,
    [ids]
  );
}
