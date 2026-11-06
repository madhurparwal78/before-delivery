import { Tx } from '../db/pool';
import { LiveEvent } from '../events';
import {
  BlockRow,
  BLOCK_COLUMNS,
  adjustBacklinks,
  blockJson,
  loadObject,
  renumberBlocks,
  touchObject,
} from './objects';
import { errorReply, validationError } from '../http/core';
import {
  BLOCK_BODY_MAX_CHARS,
  editTextOf,
  editTextOfItems,
  excerptOf,
  parseBody,
  plainTextOf,
  serializeItems,
  storedBody,
} from '../../shared/richtext';
import { literalMatch } from '../../shared/search';
import {
  MAX_OPS_PER_REQUEST,
  Op,
  applyOps,
  baseLength,
  hasOpConflict,
  transformOffset,
  transformOverCommitted,
} from '../../shared/ops';
import { loadTypes } from './types';

export const REVISION_KEEP = 200;
export const BLOCK_EXCERPT_CHARS = 60;
export const TIMELINE_EXCERPT_CHARS = 30;

export const BLOCK_MESSAGES = {
  body: 'A block can hold at most 20,000 characters.',
  baseVersion: 'Send the version you started from.',
  editId: 'Use 1 to 64 visible characters.',
  afterBlock: 'That block is not in this note.',
  moveMissingObject: 'That note no longer exists.',
  moveQuoteHome: 'Quote a block from another note.',
  moveQuotedInto: 'That note quotes this block.',
  presenceOffsets: 'Use offsets inside the block.',
  versionNotKept: 'That version is not kept.',
  originMissing: 'That block no longer exists.',
  originSameObject: 'Quote a block from another note.',
  originNotText: 'Only text blocks can be quoted.',
  searchQuery: 'Search with at most 200 characters.',
} as const;

export function opsMessage(baseVersion: number): string {
  return `Those changes don't fit version ${baseVersion}.`;
}

export async function loadBlock(tx: Tx, id: string): Promise<BlockRow | null> {
  return tx.one<BlockRow>(`select ${BLOCK_COLUMNS} from block where id = $1`, [id]);
}

/** PATCH, presence, revisions, diff and restore on a quote block act on its origin block. */
export async function resolveTextBlock(tx: Tx, block: BlockRow): Promise<BlockRow | null> {
  if (block.kind !== 'quote' || block.origin_block_id === null) return block;
  return loadBlock(tx, block.origin_block_id);
}

export async function quoteBlocksOf(tx: Tx, originBlockId: string): Promise<BlockRow[]> {
  return tx.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from block where origin_block_id = $1 and kind = 'quote' order by id`,
    [originBlockId],
  );
}

async function blockSavedEvents(
  tx: Tx,
  block: BlockRow,
  ops: Op[] | null,
  baseVersion: number,
  label: string,
  editId: string | null,
): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [];
  const fresh = (await loadBlock(tx, block.id)) ?? block;
  events.push({
    type: 'block.saved',
    data: {
      object_id: fresh.object_id,
      block: await blockJson(tx, fresh),
      ops,
      base_version: baseVersion,
      label,
      edit_id: editId,
    },
  });
  for (const quote of await quoteBlocksOf(tx, block.id)) {
    events.push({
      type: 'block.saved',
      data: {
        object_id: quote.object_id,
        block: await blockJson(tx, quote),
        ops,
        base_version: baseVersion,
        label,
        edit_id: editId,
      },
    });
  }
  return events;
}

async function storeRevision(
  tx: Tx,
  blockId: string,
  version: number,
  body: string,
  ops: Op[] | null,
  changeKind: 'create' | 'ops' | 'replace' | 'restore',
  label: string,
): Promise<void> {
  await tx.query(
    `insert into block_revision (block_id, version, body, ops, change_kind, label)
     values ($1, $2, $3, $4, $5, $6)`,
    [blockId, version, body, ops === null ? null : JSON.stringify(ops), changeKind, label],
  );
  await tx.query(
    `delete from block_revision where block_id = $1 and version <= (
       select max(version) - $2 from block_revision where block_id = $1
     )`,
    [blockId, REVISION_KEEP],
  );
}

export async function createBlock(
  tx: Tx,
  objectId: string,
  body: string,
  afterBlockId: string | null,
  label: string,
): Promise<{ block: BlockRow; events: LiveEvent[] }> {
  const canonical = storedBody(body);
  if (canonical.length > BLOCK_BODY_MAX_CHARS) throw validationError({ body: BLOCK_MESSAGES.body });
  let position: number;
  if (afterBlockId === null) {
    const row = await tx.one<{ next: number }>(
      'select coalesce(max(position), 0) + 1 as next from block where object_id = $1',
      [objectId],
    );
    position = row === null ? 1 : row.next;
  } else {
    const after = await tx.one<{ position: number }>(
      'select position from block where id = $1 and object_id = $2',
      [afterBlockId, objectId],
    );
    if (after === null) throw validationError({ after_block_id: BLOCK_MESSAGES.afterBlock });
    position = after.position + 1;
    await tx.query('update block set position = position + 1 where object_id = $1 and position >= $2', [
      objectId,
      position,
    ]);
  }
  const rows = await tx.query<BlockRow>(
    `insert into block (id, object_id, kind, position, body, version)
     values (gen_random_uuid(), $1, 'text', $2, $3, 1)
     returning ${BLOCK_COLUMNS}`,
    [objectId, position, canonical],
  );
  const block = rows[0];
  await storeRevision(tx, block.id, 1, canonical, null, 'create', label);
  await touchObject(tx, objectId);
  const events = await blockSavedEvents(tx, block, null, 0, label, null);
  return { block, events };
}

export type EditResult = { block: BlockRow; events: LiveEvent[]; version: number };

export async function replaceBlockBody(
  tx: Tx,
  block: BlockRow,
  body: string,
  baseVersion: number,
  label: string,
  editId: string | null,
): Promise<EditResult> {
  const current = await lockBlock(tx, block.id);
  if (current.version !== baseVersion) throw await versionConflict(tx, current);
  const canonical = storedBody(body);
  if (canonical.length > BLOCK_BODY_MAX_CHARS) throw validationError({ body: BLOCK_MESSAGES.body });
  const version = current.version + 1;
  await tx.query('update block set body = $2, version = $3, updated_at = now() where id = $1', [
    block.id,
    canonical,
    version,
  ]);
  await storeRevision(tx, block.id, version, canonical, null, 'replace', label);
  await touchObject(tx, current.object_id);
  const updated = (await loadBlock(tx, block.id)) as BlockRow;
  const events = await blockSavedEvents(tx, updated, null, current.version, label, editId);
  return { block: updated, events, version };
}

async function lockBlock(tx: Tx, id: string): Promise<BlockRow> {
  const rows = await tx.query<BlockRow>(`select ${BLOCK_COLUMNS} from block where id = $1 for update`, [id]);
  return rows[0];
}

async function versionConflict(tx: Tx, block: BlockRow): Promise<never> {
  throw errorReply(409, 'version_conflict', { current: await blockJson(tx, block) });
}

export async function editBlockWithOps(
  tx: Tx,
  block: BlockRow,
  ops: Op[],
  baseVersion: number,
  label: string,
  editId: string | null,
): Promise<EditResult> {
  const current = await lockBlock(tx, block.id);
  if (ops.length < 1 || ops.length > MAX_OPS_PER_REQUEST) {
    throw validationError({ ops: opsMessage(baseVersion) });
  }
  if (baseVersion > current.version) throw await versionConflict(tx, current);
  const revisions = await tx.query<{ version: number; body: string; ops: Op[] | null; change_kind: string }>(
    'select version, body, ops, change_kind from block_revision where block_id = $1 order by version asc',
    [block.id],
  );
  const oldestKept = revisions.length === 0 ? current.version : revisions[0].version;
  const baseRevision = revisions.find((revision) => revision.version === baseVersion);
  if (baseVersion < oldestKept || baseRevision === undefined) {
    throw await versionConflict(tx, current);
  }
  if (baseLength(ops) !== editTextOf(baseRevision.body).length) {
    throw validationError({ ops: opsMessage(baseVersion) });
  }
  let merged = ops;
  for (const revision of revisions) {
    if (revision.version <= baseVersion) continue;
    if (revision.change_kind === 'replace' || revision.change_kind === 'restore' || revision.ops === null) {
      throw await versionConflict(tx, current);
    }
    if (hasOpConflict(merged, revision.ops)) throw await versionConflict(tx, current);
    merged = transformOverCommitted(merged, revision.ops);
  }
  const items = applyOps(parseBody(current.body ?? ''), merged);
  const body = serializeItems(items);
  if (body.length > BLOCK_BODY_MAX_CHARS) throw validationError({ body: BLOCK_MESSAGES.body });
  const version = current.version + 1;
  await tx.query('update block set body = $2, version = $3, updated_at = now() where id = $1', [
    block.id,
    body,
    version,
  ]);
  await storeRevision(tx, block.id, version, body, merged, 'ops', label);
  await touchObject(tx, current.object_id);
  await movePresenceThrough(tx, block.id, merged, editTextOfItems(items).length);
  const updated = (await loadBlock(tx, block.id)) as BlockRow;
  const events = await blockSavedEvents(tx, updated, merged, current.version, label, editId);
  return { block: updated, events, version };
}

async function movePresenceThrough(tx: Tx, blockId: string, ops: Op[], length: number): Promise<void> {
  const rows = await tx.query<{ session_id: string; anchor: number; head: number }>(
    'select session_id, anchor, head from presence where block_id = $1',
    [blockId],
  );
  for (const row of rows) {
    const anchor = Math.min(length, transformOffset(row.anchor, ops, false));
    const head = Math.min(length, transformOffset(row.head, ops, false));
    await tx.query('update presence set anchor = $3, head = $4 where session_id = $1 and block_id = $2', [
      row.session_id,
      blockId,
      anchor,
      head,
    ]);
  }
}

export async function restoreRevision(
  tx: Tx,
  block: BlockRow,
  version: number,
  baseVersion: number,
  label: string,
): Promise<EditResult> {
  const current = await lockBlock(tx, block.id);
  const revision = await tx.one<{ body: string }>(
    'select body from block_revision where block_id = $1 and version = $2',
    [block.id, version],
  );
  if (revision === null) throw validationError({ version: BLOCK_MESSAGES.versionNotKept });
  if (baseVersion !== current.version) throw await versionConflict(tx, current);
  const nextVersion = current.version + 1;
  await tx.query('update block set body = $2, version = $3, updated_at = now() where id = $1', [
    block.id,
    revision.body,
    nextVersion,
  ]);
  await storeRevision(tx, block.id, nextVersion, revision.body, null, 'restore', label);
  await touchObject(tx, current.object_id);
  const updated = (await loadBlock(tx, block.id)) as BlockRow;
  const events = await blockSavedEvents(tx, updated, null, current.version, label, null);
  return { block: updated, events, version: nextVersion };
}

export async function deleteBlock(
  tx: Tx,
  block: BlockRow,
): Promise<{
  events: LiveEvent[];
  quoteResult: { origin_object_id: string; origin_backlinks: number } | null;
  attachmentKey: string | null;
}> {
  const events: LiveEvent[] = [];
  if (block.kind === 'quote') {
    const edge = await tx.one<{ id: string; to_object_id: string }>(
      'select id, to_object_id from link_edge where block_id = $1',
      [block.id],
    );
    await tx.query('delete from link_edge where block_id = $1', [block.id]);
    await tx.query('delete from block where id = $1', [block.id]);
    await renumberBlocks(tx, block.object_id);
    await touchObject(tx, block.object_id);
    events.push({ type: 'block.removed', data: { object_id: block.object_id, block_id: block.id } });
    let originBacklinks = 0;
    let originObjectId = '';
    if (edge !== null) {
      originObjectId = edge.to_object_id;
      originBacklinks = await adjustBacklinks(tx, edge.to_object_id, -1);
      events.push({
        type: 'backlinks.changed',
        data: { object_id: edge.to_object_id, backlinks: originBacklinks },
      });
    }
    return {
      events,
      quoteResult: { origin_object_id: originObjectId, origin_backlinks: originBacklinks },
      attachmentKey: null,
    };
  }
  const quotes = await quoteBlocksOf(tx, block.id);
  if (quotes.length > 0) throw errorReply(409, 'block_quoted', { quoted_in: quotes.length });
  let attachmentKey: string | null = null;
  if (block.attachment_id !== null) {
    const attachment = await tx.one<{ storage_key: string }>(
      'select storage_key from attachment where id = $1',
      [block.attachment_id],
    );
    attachmentKey = attachment === null ? null : attachment.storage_key;
    await tx.query('delete from attachment where id = $1', [block.attachment_id]);
  }
  await tx.query('delete from block where id = $1', [block.id]);
  await renumberBlocks(tx, block.object_id);
  await touchObject(tx, block.object_id);
  events.push({ type: 'block.removed', data: { object_id: block.object_id, block_id: block.id } });
  return { events, quoteResult: null, attachmentKey };
}

export async function createQuote(
  tx: Tx,
  hostObjectId: string,
  originBlockId: string,
  afterBlockId: string | null,
  label: string,
): Promise<{ block: BlockRow; originBacklinks: number; events: LiveEvent[] }> {
  const origin = await loadBlock(tx, originBlockId);
  if (origin === null) throw validationError({ origin_block_id: BLOCK_MESSAGES.originMissing });
  const target = origin.kind === 'quote' ? await resolveTextBlock(tx, origin) : origin;
  if (target === null) throw validationError({ origin_block_id: BLOCK_MESSAGES.originMissing });
  if (target.kind !== 'text') throw validationError({ origin_block_id: BLOCK_MESSAGES.originNotText });
  if (target.object_id === hostObjectId) {
    throw validationError({ origin_block_id: BLOCK_MESSAGES.originSameObject });
  }
  let position: number;
  if (afterBlockId === null) {
    const row = await tx.one<{ next: number }>(
      'select coalesce(max(position), 0) + 1 as next from block where object_id = $1',
      [hostObjectId],
    );
    position = row === null ? 1 : row.next;
  } else {
    const after = await tx.one<{ position: number }>(
      'select position from block where id = $1 and object_id = $2',
      [afterBlockId, hostObjectId],
    );
    if (after === null) throw validationError({ after_block_id: BLOCK_MESSAGES.afterBlock });
    position = after.position + 1;
    await tx.query('update block set position = position + 1 where object_id = $1 and position >= $2', [
      hostObjectId,
      position,
    ]);
  }
  const rows = await tx.query<BlockRow>(
    `insert into block (id, object_id, kind, position, origin_block_id)
     values (gen_random_uuid(), $1, 'quote', $2, $3) returning ${BLOCK_COLUMNS}`,
    [hostObjectId, position, target.id],
  );
  const block = rows[0];
  await tx.query(
    `insert into link_edge (id, from_object_id, to_object_id, kind, block_id)
     values (gen_random_uuid(), $1, $2, 'quote', $3)`,
    [hostObjectId, target.object_id, block.id],
  );
  const originBacklinks = await adjustBacklinks(tx, target.object_id, 1);
  await touchObject(tx, hostObjectId);
  const events: LiveEvent[] = [
    {
      type: 'block.saved',
      data: {
        object_id: hostObjectId,
        block: await blockJson(tx, block),
        ops: null,
        base_version: 0,
        label,
        edit_id: null,
      },
    },
    { type: 'backlinks.changed', data: { object_id: target.object_id, backlinks: originBacklinks } },
  ];
  return { block, originBacklinks, events };
}

export async function moveBlock(
  tx: Tx,
  block: BlockRow,
  targetObjectId: string,
  afterBlockId: string | null,
): Promise<{ block: BlockRow; events: LiveEvent[] }> {
  if (block.kind === 'attachment') throw errorReply(409, 'not_movable');
  const target = await loadObject(tx, targetObjectId);
  if (target === null) throw validationError({ object_id: BLOCK_MESSAGES.moveMissingObject });
  if (block.kind === 'quote' && block.origin_block_id !== null) {
    const origin = await loadBlock(tx, block.origin_block_id);
    if (origin !== null && origin.object_id === targetObjectId) {
      throw validationError({ object_id: BLOCK_MESSAGES.moveQuoteHome });
    }
  }
  if (block.kind === 'text') {
    const quotes = await quoteBlocksOf(tx, block.id);
    if (quotes.some((quote) => quote.object_id === targetObjectId)) {
      throw validationError({ object_id: BLOCK_MESSAGES.moveQuotedInto });
    }
  }
  const sourceObjectId = block.object_id;
  let position: number;
  if (afterBlockId === null) {
    const row = await tx.one<{ next: number }>(
      'select coalesce(max(position), 0) + 1 as next from block where object_id = $1 and id <> $2',
      [targetObjectId, block.id],
    );
    position = row === null ? 1 : row.next;
  } else {
    const after = await tx.one<{ position: number }>(
      'select position from block where id = $1 and object_id = $2',
      [afterBlockId, targetObjectId],
    );
    if (after === null) throw validationError({ after_block_id: BLOCK_MESSAGES.afterBlock });
    position = after.position + 1;
    await tx.query('update block set position = position + 1 where object_id = $1 and position >= $2 and id <> $3', [
      targetObjectId,
      position,
      block.id,
    ]);
  }
  await tx.query('update block set object_id = $2, position = $3, updated_at = now() where id = $1', [
    block.id,
    targetObjectId,
    position,
  ]);
  const events: LiveEvent[] = [];
  const changedCounts = new Map<string, number>();
  if (block.kind === 'quote') {
    await tx.query('update link_edge set from_object_id = $2 where block_id = $1', [block.id, targetObjectId]);
  } else {
    const quotes = await quoteBlocksOf(tx, block.id);
    if (quotes.length > 0) {
      for (const quote of quotes) {
        await tx.query(`update link_edge set to_object_id = $2 where block_id = $1`, [quote.id, targetObjectId]);
      }
      changedCounts.set(sourceObjectId, await adjustBacklinks(tx, sourceObjectId, -quotes.length));
      changedCounts.set(targetObjectId, await adjustBacklinks(tx, targetObjectId, quotes.length));
    }
  }
  await renumberBlocks(tx, sourceObjectId);
  await renumberBlocks(tx, targetObjectId);
  await touchObject(tx, sourceObjectId);
  await touchObject(tx, targetObjectId);
  const moved = (await loadBlock(tx, block.id)) as BlockRow;
  events.push({ type: 'block.removed', data: { object_id: sourceObjectId, block_id: block.id } });
  events.push({
    type: 'block.saved',
    data: {
      object_id: targetObjectId,
      block: await blockJson(tx, moved),
      ops: null,
      base_version: 0,
      label: 'move',
      edit_id: null,
    },
  });
  for (const [objectId, count] of changedCounts) {
    events.push({ type: 'backlinks.changed', data: { object_id: objectId, backlinks: count } });
  }
  return { block: moved, events };
}

export async function revisionsJson(tx: Tx, blockId: string): Promise<Record<string, unknown>[]> {
  const rows = await tx.query<{ version: number; body: string; label: string; created_at: Date }>(
    'select version, body, label, created_at from block_revision where block_id = $1 order by version desc',
    [blockId],
  );
  return rows.map((row) => ({
    version: row.version,
    body: row.body,
    plain: plainTextOf(row.body),
    label: row.label,
    created_at: row.created_at.toISOString(),
  }));
}

export async function revisionBody(tx: Tx, blockId: string, version: number): Promise<string | null> {
  const row = await tx.one<{ body: string }>(
    'select body from block_revision where block_id = $1 and version = $2',
    [blockId, version],
  );
  return row === null ? null : row.body;
}

export async function searchTextBlocks(
  tx: Tx,
  q: string,
  excludeObjectId: string | null,
): Promise<Record<string, unknown>[]> {
  const rows = await tx.query<{
    id: string;
    object_id: string;
    object_title: string;
    body: string | null;
  }>(
    `select b.id, b.object_id, o.title as object_title, b.body
       from block b join object_note o on o.id = b.object_id
      where b.kind = 'text' and ($1::uuid is null or b.object_id <> $1::uuid)
      order by b.updated_at desc, b.id desc`,
    [excludeObjectId],
  );
  const needle = q.trim().toLowerCase();
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (needle.length > 0 && !literalMatch(plainTextOf(row.body ?? ''), needle)) continue;
    results.push({
      block_id: row.id,
      object_id: row.object_id,
      object_title: row.object_title,
      excerpt: excerptOf(row.body ?? '', BLOCK_EXCERPT_CHARS),
    });
    if (results.length === 20) break;
  }
  return results;
}

/** Move a presence report from the version it was taken on to the current version. */
export async function presenceToCurrent(
  tx: Tx,
  blockId: string,
  fromVersion: number,
  anchor: number,
  head: number,
): Promise<{ anchor: number; head: number }> {
  const revisions = await tx.query<{ version: number; ops: Op[] | null; body: string }>(
    'select version, ops, body from block_revision where block_id = $1 and version > $2 order by version asc',
    [blockId, fromVersion],
  );
  let movedAnchor = anchor;
  let movedHead = head;
  for (const revision of revisions) {
    if (revision.ops === null) {
      const length = editTextOf(revision.body).length;
      movedAnchor = Math.min(movedAnchor, length);
      movedHead = Math.min(movedHead, length);
      continue;
    }
    movedAnchor = transformOffset(movedAnchor, revision.ops, false);
    movedHead = transformOffset(movedHead, revision.ops, false);
  }
  return { anchor: movedAnchor, head: movedHead };
}
