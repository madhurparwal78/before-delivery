import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { alerts } from '../shared/copy.js';
import { decideMove, exceedsDepth, type MoveFacts } from '../shared/moves.js';
import type { MoveOp } from '../shared/types.js';
import { commit, type MutationOutcome } from './changes.js';
import { config } from './config.js';
import { conflict, invalid, notFound } from './errors.js';
import type { HistoryStep } from './history.js';
import { redoStep, undoStep } from './history.js';
import {
  closeGap,
  deleteRows,
  expand,
  insertRow,
  placeAt,
  readTextFields,
  renumber,
  savedRowOf,
  subtreeIds,
  trashRows,
  writeCollapsed,
  writeCompleted,
  writeText,
  type SavedRow
} from './rows.js';
import { requireOpen, type Scope } from './scope.js';
import type { BulletRow, Tree } from './tree.js';

/** A destination parent given as a placement resolves to the original that holds the children. */
function realParent(tree: Tree, placementId: string | null): BulletRow | null {
  if (placementId === null) return null;
  const row = tree.row(placementId);
  if (row === undefined) throw notFound();
  const original = tree.original(row);
  if (original === undefined) throw notFound();
  return original;
}

/** The one inside-itself check, followed through every copy above the destination. */
function placesInsideItself(tree: Tree, originalId: string, destParentId: string | null): boolean {
  if (destParentId === null) return false;
  for (const id of tree.reach(destParentId)) {
    const row = tree.row(id);
    if (row === undefined) continue;
    const original = tree.original(row) ?? row;
    if (original.id === originalId) return true;
  }
  return false;
}

function requireRoom(tree: Tree, row: BulletRow, parent: BulletRow | null): void {
  const parentDepth = parent === null ? -1 : tree.depthOf(parent.id);
  if (exceedsDepth(parentDepth, tree.displayHeight(row), config.maxDepth)) {
    throw conflict('too_deep');
  }
}

function requireNotShareRoot(scope: Scope, bulletId: string): void {
  if (scope.shareRootId === bulletId) throw conflict('share_root');
}

function copyIds(tree: Tree, originalId: string): string[] {
  return tree.copies(originalId).map((copy) => copy.id);
}

function requireText(raw: string): string {
  if (raw.length > config.bulletMaxChars) {
    throw invalid({ text: alerts.textTooLong(config.bulletMaxChars) });
  }
  return raw;
}

async function editorName(client: PoolClient, userId: string | null): Promise<string> {
  if (userId === null) return 'Someone else';
  const result = await client.query(`select name from users where id = $1`, [userId]);
  return (result.rows[0] as { name: string } | undefined)?.name ?? 'Someone else';
}

async function staleRevision(client: PoolClient, original: BulletRow): Promise<never> {
  throw conflict(
    'stale_revision',
    {
      current: { text: original.text, revision: original.revision },
      editor: { name: await editorName(client, original.revisionAuthor) }
    },
    await editorName(client, original.revisionAuthor)
  );
}

export interface CreateInput {
  parentId: string | null;
  afterId: string | null;
  text: string;
  splitFrom: { id: string; text: string; revision: number } | null;
}

/** Adds a bullet, which may also carry the tail of a split line. */
export async function createBullet(
  scope: Scope,
  input: CreateInput
): Promise<{ id: string; seq: number }> {
  requireText(input.text);
  if (input.splitFrom !== null) requireText(input.splitFrom.text);
  const { result, seq } = await commit(scope, async (client, tree) => {
    if (input.parentId === null && scope.shareRootId !== null) throw notFound();
    if (input.parentId !== null) requireOpen(scope, tree, input.parentId);
    const parent = realParent(tree, input.parentId);
    let index = 0;
    if (input.afterId !== null) {
      requireOpen(scope, tree, input.afterId);
      const after = tree.row(input.afterId)!;
      if ((after.parentId ?? null) !== (parent?.id ?? null)) {
        throw invalid({ afterId: 'That bullet is not inside the parent.' });
      }
      index = after.position + 1;
    }
    const parentDepth = parent === null ? -1 : tree.depthOf(parent.id);
    if (exceedsDepth(parentDepth, 0, config.maxDepth)) throw conflict('too_deep');

    const fields = readTextFields(input.text);
    const row: SavedRow = {
      id: randomUUID(),
      ownerId: scope.ownerId,
      parentId: parent?.id ?? null,
      position: index,
      text: fields.text,
      completed: false,
      collapsed: false,
      date: fields.date,
      tags: fields.tags,
      mentions: fields.mentions,
      mirrorOf: null,
      revision: 1,
      revisionAuthor: scope.viewer.userId
    };
    await insertRow(client, row);

    const affected = [row.id];
    let step: HistoryStep = { kind: 'new bullet', row };
    if (input.splitFrom !== null) {
      requireOpen(scope, tree, input.splitFrom.id);
      const source = tree.row(input.splitFrom.id)!;
      const original = tree.original(source);
      if (original === undefined) throw notFound();
      if (input.splitFrom.revision < original.revision) await staleRevision(client, original);
      const before = {
        text: original.text,
        date: original.date,
        tags: original.tags,
        mentions: original.mentions,
        revision: original.revision
      };
      const fieldsBefore = readTextFields(input.splitFrom.text);
      const revision = await writeText(client, original.id, fieldsBefore, scope.viewer.userId);
      step = {
        kind: 'new bullet',
        row,
        split: {
          bulletId: original.id,
          before,
          after: { ...fieldsBefore, revision }
        }
      };
      affected.push(original.id, ...copyIds(tree, original.id));
    }
    const outcome: MutationOutcome<string> = { result: row.id, affected, step };
    return outcome;
  });
  return { id: result, seq };
}

export interface PatchInput {
  text?: string;
  revision?: number;
  completed?: boolean;
  collapsed?: boolean;
}

export async function patchBullet(
  scope: Scope,
  bulletId: string,
  input: PatchInput
): Promise<{ seq: number }> {
  if (input.text !== undefined) {
    requireText(input.text);
    if (input.revision === undefined) {
      throw invalid({ revision: 'Send the revision you last saw.' });
    }
  }
  const { seq } = await commit(scope, async (client, tree) => {
    requireOpen(scope, tree, bulletId);
    const row = tree.row(bulletId)!;
    const original = tree.original(row);
    if (original === undefined) throw notFound();
    const affected: string[] = [];
    let step: HistoryStep | undefined;

    if (input.text !== undefined) {
      if (input.revision! < original.revision) await staleRevision(client, original);
      const before = {
        text: original.text,
        date: original.date,
        tags: original.tags,
        mentions: original.mentions,
        revision: original.revision
      };
      const fields = readTextFields(input.text);
      const revision = await writeText(client, original.id, fields, scope.viewer.userId);
      step = { kind: 'text edit', bulletId: original.id, before, after: { ...fields, revision } };
      affected.push(original.id, ...copyIds(tree, original.id));
    }
    if (input.completed !== undefined && input.completed !== original.completed) {
      const revision = await writeCompleted(
        client,
        original.id,
        input.completed,
        scope.viewer.userId
      );
      if (step === undefined) {
        step = {
          kind: 'completion',
          bulletId: original.id,
          before: original.completed,
          after: input.completed,
          afterRevision: revision
        };
      }
      affected.push(original.id, ...copyIds(tree, original.id));
    }
    if (input.collapsed !== undefined && input.collapsed !== row.collapsed) {
      await writeCollapsed(client, row.id, input.collapsed);
      affected.push(row.id);
    }
    if (!affected.includes(bulletId)) affected.push(bulletId);
    const outcome: MutationOutcome<null> = { result: null, affected, step };
    return outcome;
  });
  return { seq };
}

export interface DeleteOutcome {
  result: 'trashed' | 'copy_removed';
  count: number;
  seq: number;
}

export async function deleteBullet(scope: Scope, bulletId: string): Promise<DeleteOutcome> {
  type Removal = { result: 'trashed' | 'copy_removed'; count: number };
  const { result, seq } = await commit<Removal>(scope, async (client, tree) => {
    requireOpen(scope, tree, bulletId);
    requireNotShareRoot(scope, bulletId);
    const row = tree.row(bulletId)!;
    if (row.mirrorOf !== null) {
      await closeGap(client, row.ownerId, row.parentId, row.position);
      await deleteRows(client, [row.id]);
      await renumber(client, row.ownerId, row.parentId);
      const outcome: MutationOutcome<Removal> = {
        result: { result: 'copy_removed', count: 1 },
        affected: [],
        removed: [row.id],
        step: { kind: 'delete', mode: 'copy', rootId: row.id, rows: [savedRowOf(row)] }
      };
      return outcome;
    }
    const ids = await subtreeIds(client, row.id);
    const saved = ids.map((id) => savedRowOf(tree.row(id)!));
    await trashRows(client, ids, config.trashSeconds);
    await closeGap(client, row.ownerId, row.parentId, row.position);
    await renumber(client, row.ownerId, row.parentId);
    const placeholders = ids.flatMap((id) => copyIds(tree, id)).filter((id) => !ids.includes(id));
    const outcome: MutationOutcome<Removal> = {
      result: { result: 'trashed', count: ids.length },
      affected: placeholders,
      removed: ids,
      step: { kind: 'delete', mode: 'trash', rootId: row.id, rows: saved }
    };
    return outcome;
  });
  return { ...result, seq };
}

function factsFor(scope: Scope, tree: Tree, row: BulletRow): MoveFacts {
  const siblings = tree.children(row.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === row.id);
  const parentIsTop =
    row.parentId === null || (scope.shareRootId !== null && row.parentId === scope.shareRootId);
  let parentHasPreviousSibling = false;
  let parentHasNextSibling = false;
  if (row.parentId !== null) {
    const parent = tree.row(row.parentId);
    if (parent !== undefined) {
      const parentSiblings = tree.children(parent.parentId);
      const parentIndex = parentSiblings.findIndex((sibling) => sibling.id === parent.id);
      parentHasPreviousSibling = parentIndex > 0;
      parentHasNextSibling = parentIndex > -1 && parentIndex < parentSiblings.length - 1;
    }
  }
  return {
    isShareRoot: scope.shareRootId === row.id,
    hasPreviousSibling: index > 0,
    hasNextSibling: index > -1 && index < siblings.length - 1,
    parentIsTop,
    parentHasPreviousSibling,
    parentHasNextSibling
  };
}

function parentOf(tree: Tree, row: BulletRow): BulletRow | null {
  return row.parentId === null ? null : (tree.row(row.parentId) ?? null);
}

/** Where a published move op lands the bullet. */
function destinationFor(
  tree: Tree,
  row: BulletRow,
  op: MoveOp
): { parent: BulletRow | null; index: number; expandId: string | null } {
  const siblings = tree.children(row.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === row.id);
  const parent = parentOf(tree, row);
  switch (op) {
    case 'indent': {
      const previous = siblings[index - 1]!;
      const newParent = tree.original(previous);
      if (newParent === undefined) throw conflict('no_previous_sibling');
      return { parent: newParent, index: tree.children(newParent.id).length, expandId: previous.id };
    }
    case 'outdent': {
      const held = parent!;
      return { parent: parentOf(tree, held), index: held.position + 1, expandId: null };
    }
    case 'up': {
      if (index > 0) return { parent, index: index - 1, expandId: null };
      const held = parent!;
      const heldSiblings = tree.children(held.parentId);
      const heldIndex = heldSiblings.findIndex((sibling) => sibling.id === held.id);
      const target = heldSiblings[heldIndex - 1]!;
      const newParent = tree.original(target);
      if (newParent === undefined) throw conflict('at_first');
      return { parent: newParent, index: tree.children(newParent.id).length, expandId: target.id };
    }
    case 'down': {
      if (index < siblings.length - 1) return { parent, index: index + 1, expandId: null };
      const held = parent!;
      const heldSiblings = tree.children(held.parentId);
      const heldIndex = heldSiblings.findIndex((sibling) => sibling.id === held.id);
      const target = heldSiblings[heldIndex + 1]!;
      const newParent = tree.original(target);
      if (newParent === undefined) throw conflict('at_last');
      return { parent: newParent, index: 0, expandId: target.id };
    }
  }
}

export type MoveRequest = { op: MoveOp } | { parentId: string | null; index: number };

export async function moveBullet(
  scope: Scope,
  bulletId: string,
  request: MoveRequest
): Promise<{ seq: number }> {
  const { seq } = await commit(scope, async (client, tree) => {
    requireOpen(scope, tree, bulletId);
    requireNotShareRoot(scope, bulletId);
    const row = tree.row(bulletId)!;
    const original = tree.original(row) ?? row;
    const from = { parentId: row.parentId, position: row.position };

    let destination: { parent: BulletRow | null; index: number; expandId: string | null };
    let kind: 'move' | 'indent' | 'outdent' = 'move';
    if ('op' in request) {
      const refusal = decideMove(request.op, factsFor(scope, tree, row));
      if (refusal !== null) throw conflict(refusal);
      destination = destinationFor(tree, row, request.op);
      if (request.op === 'indent' || request.op === 'outdent') kind = request.op;
    } else {
      if (request.parentId === null && scope.shareRootId !== null) throw notFound();
      if (request.parentId !== null) requireOpen(scope, tree, request.parentId);
      const parent = realParent(tree, request.parentId);
      const siblingCount = tree.children(parent?.id ?? null).length;
      const sameParent = (parent?.id ?? null) === row.parentId;
      const highest = sameParent ? siblingCount - 1 : siblingCount;
      if (!Number.isInteger(request.index) || request.index < 0 || request.index > highest) {
        throw invalid({ index: 'Pick a position among the children.' });
      }
      destination = { parent, index: request.index, expandId: null };
    }

    if (placesInsideItself(tree, original.id, destination.parent?.id ?? null)) {
      throw conflict('inside_itself');
    }
    requireRoom(tree, row, destination.parent);
    if (destination.expandId !== null) await expand(client, destination.expandId);
    await placeAt(client, row, destination.parent?.id ?? null, destination.index);
    await renumber(client, row.ownerId, from.parentId);
    await renumber(client, row.ownerId, destination.parent?.id ?? null);

    const affected = [row.id, ...(destination.expandId === null ? [] : [destination.expandId])];
    const outcome: MutationOutcome<null> = {
      result: null,
      affected,
      step: {
        kind,
        bulletId: row.id,
        from,
        to: { parentId: destination.parent?.id ?? null, position: destination.index }
      }
    };
    return outcome;
  });
  return { seq };
}

export async function mirrorBullet(
  scope: Scope,
  bulletId: string,
  destinationInput: { parentId: string | null; index: number } | null
): Promise<{ id: string; seq: number }> {
  const { result, seq } = await commit(scope, async (client, tree) => {
    requireOpen(scope, tree, bulletId);
    requireNotShareRoot(scope, bulletId);
    const row = tree.row(bulletId)!;
    const original = tree.original(row);
    if (original === undefined) throw notFound();

    let parent: BulletRow | null;
    let index: number;
    if (destinationInput === null) {
      parent = row.parentId === null ? null : tree.row(row.parentId)!;
      index = row.position + 1;
    } else {
      if (destinationInput.parentId === null && scope.shareRootId !== null) throw notFound();
      if (destinationInput.parentId !== null) requireOpen(scope, tree, destinationInput.parentId);
      parent = realParent(tree, destinationInput.parentId);
      const siblingCount = tree.children(parent?.id ?? null).length;
      if (
        !Number.isInteger(destinationInput.index) ||
        destinationInput.index < 0 ||
        destinationInput.index > siblingCount
      ) {
        throw invalid({ index: 'Pick a position among the children.' });
      }
      index = destinationInput.index;
    }
    if (placesInsideItself(tree, original.id, parent?.id ?? null)) throw conflict('inside_itself');
    requireRoom(tree, original, parent);

    const copy: SavedRow = {
      id: randomUUID(),
      ownerId: scope.ownerId,
      parentId: parent?.id ?? null,
      position: index,
      text: '',
      completed: false,
      collapsed: false,
      date: null,
      tags: [],
      mentions: [],
      mirrorOf: original.id,
      revision: 1,
      revisionAuthor: scope.viewer.userId
    };
    await insertRow(client, copy);
    const outcome: MutationOutcome<string> = {
      result: copy.id,
      affected: [copy.id],
      step: { kind: 'mirror', row: copy }
    };
    return outcome;
  });
  return { id: result, seq };
}

export async function undo(scope: Scope): Promise<{ step: string; bulletId: string; seq: number }> {
  const { result, seq } = await commit(scope, async (client) => {
    const { kind, applied } = await undoStep(client, scope);
    const outcome: MutationOutcome<{ step: string; bulletId: string }> = {
      result: { step: kind, bulletId: applied.bulletId },
      affected: applied.affected,
      removed: applied.removed
    };
    return outcome;
  });
  return { ...result, seq };
}

export async function redo(scope: Scope): Promise<{ step: string; bulletId: string; seq: number }> {
  const { result, seq } = await commit(scope, async (client) => {
    const { kind, applied } = await redoStep(client, scope);
    const outcome: MutationOutcome<{ step: string; bulletId: string }> = {
      result: { step: kind, bulletId: applied.bulletId },
      affected: applied.affected,
      removed: applied.removed
    };
    return outcome;
  });
  return { ...result, seq };
}
