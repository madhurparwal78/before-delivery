// Blocks: the transactional engine for edits, merges, revisions, quotes and
// moves. Every change here commits with its events in one transaction.

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  sanitizeBody,
  plainText,
  editText,
  applyOps,
  transformOps,
  isOp,
  type Op,
} from "../shared/richtext.js";
import { recordEvent } from "./sync.js";

export const BLOCK_BODY_CAP = 20000;
export const REVISIONS_KEPT = 200;

interface BlockRow {
  id: string;
  object_id: string;
  kind: "text" | "quote" | "attachment";
  position: number;
  body: string;
  version: number;
  origin_block_id: string | null;
  attachment_id: string | null;
}

interface RevisionRow {
  block_id: string;
  version: number;
  body: string;
  plain: string;
  label: string;
  ops: Op[] | null;
  is_full: boolean; // selected as "full" via alias
  created_at: Date;
}

export interface CommitResult {
  block: BlockRow;
  ops: Op[] | null; // ops as transformed, null for full replacement/restore
  baseVersion: number;
  conflict: boolean;
}

export function opsValidShape(ops: unknown): ops is Op[] {
  if (!Array.isArray(ops)) return false;
  if (ops.length < 1 || ops.length > 1000) return false;
  for (const op of ops) {
    if (!isOp(op)) return false;
  }
  return true;
}

/** Retain+delete lengths must equal the base version's edit-text length. */
export function opsAligned(ops: Op[], editLen: number): boolean {
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) pos += op.retain;
    else if ("delete" in op) pos += op.delete;
    if (pos > editLen) return false;
  }
  return pos === editLen;
}

async function loadBlock(client: PoolClient, id: string): Promise<BlockRow | null> {
  const res = await client.query<BlockRow>(
    "SELECT id, object_id, kind, position, body, version, origin_block_id, attachment_id FROM blocks WHERE id = $1 FOR UPDATE",
    [id]
  );
  return res.rows[0] ?? null;
}

async function loadRevisions(client: PoolClient, blockId: string): Promise<RevisionRow[]> {
  const res = await client.query<RevisionRow & { full: boolean }>(
    "SELECT block_id, version, body, plain, label, ops, is_full AS full, created_at FROM revisions WHERE block_id = $1 ORDER BY version DESC",
    [blockId]
  );
  return res.rows.map((r) => ({ ...r, is_full: r.full, ops: r.ops === null ? null : (r.ops as Op[]) }));
}

async function storeRevision(client: PoolClient, blockId: string, version: number, body: string, label: string, ops: Op[] | null, full: boolean): Promise<void> {
  const plain = plainText(body);
  await client.query(
    "INSERT INTO revisions (block_id, version, body, plain, label, ops, is_full, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
    [blockId, version, body, plain, label, ops === null ? null : JSON.stringify(ops), full]
  );
  // keep the newest 200 revisions
  await client.query(
    `DELETE FROM revisions WHERE block_id = $1 AND version < (
       SELECT min(version) FROM (
         SELECT version FROM revisions WHERE block_id = $1 ORDER BY version DESC LIMIT $2
       ) kept
     )`,
    [blockId, REVISIONS_KEPT]
  );
}

export interface SaveBlockInput {
  blockId: string;
  body?: unknown;
  ops?: unknown;
  baseVersion: number;
  editId: string | null;
  label: string;
  kind: "full" | "ops";
}

export class BlockError extends Error {
  constructor(
    public code: "version_conflict" | "validation" | "not_found" | "not_editable" | "block_quoted",
    public validationField?: string,
    public messageText?: string,
    public extra?: Record<string, unknown>
  ) {
    super(code);
  }
}

/** The body of a kept version, or null when it is not kept. */
async function bodyOfVersion(client: PoolClient, revisions: RevisionRow[], currentBody: string, version: number, currentVersion: number): Promise<string | null> {
  if (version === currentVersion) return currentBody;
  const rev = revisions.find((r) => r.version === version);
  return rev ? rev.body : null;
}

/**
 * Apply an edit to a text block inside the caller's transaction, merging in
 * commit order and refusing only the published conflict cases. Emits
 * block.saved events for the block and every quote block that shows it, and
 * presence.changed for the block's presence.
 */
export async function commitBlockEdit(client: PoolClient, input: SaveBlockInput): Promise<CommitResult> {
  const block = await loadBlock(client, input.blockId);
  if (block === null) throw new BlockError("not_found");
  const target = block.kind === "quote" ? await resolveOrigin(client, block) : block;
  if (target.kind !== "text") throw new BlockError("not_editable");

  const currentVersion = target.version;
  const revisions = await loadRevisions(client, target.id);
  const oldestKept = revisions.length > 0 ? revisions[revisions.length - 1].version : currentVersion;

  let newBody: string;
  let committedOps: Op[] | null = null;

  if (input.kind === "full") {
    const body = typeof input.body === "string" ? input.body : "";
    newBody = sanitizeBody(body);
    if (newBody.length > BLOCK_BODY_CAP) throw new BlockError("validation", "body", "A block can hold at most 20,000 characters.");
    if (input.baseVersion !== currentVersion) {
      throw new BlockError("version_conflict");
    }
  } else {
    const ops = input.ops as Op[];
    const baseBody = await bodyOfVersion(client, revisions, target.body, input.baseVersion, currentVersion);
    if (baseBody === null) throw new BlockError("version_conflict");
    if (!opsAligned(ops, editText(baseBody).length)) {
      throw new BlockError("validation", "ops", `Those changes don't fit version ${input.baseVersion}.`);
    }
    if (input.baseVersion < currentVersion) {
      if (input.baseVersion < oldestKept) throw new BlockError("version_conflict");
      let working = ops;
      const ascending = revisions
        .filter((r) => r.version > input.baseVersion && r.version <= currentVersion)
        .sort((a, b) => a.version - b.version);
      for (const rev of ascending) {
        if (rev.is_full) throw new BlockError("version_conflict"); // an intervening full replacement or restore
        if (rev.ops === null) throw new BlockError("version_conflict");
        const t = transformOps(working, rev.ops);
        if (t.conflict) throw new BlockError("version_conflict");
        working = t.ops;
      }
      newBody = applyOps(target.body, working);
      committedOps = working;
    } else {
      newBody = applyOps(target.body, ops);
      committedOps = ops;
    }
    if (newBody.length > BLOCK_BODY_CAP) throw new BlockError("validation", "body", "A block can hold at most 20,000 characters.");
  }
  const newVersion = currentVersion + 1;
  await client.query("UPDATE blocks SET body = $1, version = $2, updated_at = now() WHERE id = $3", [newBody, newVersion, target.id]);
  await storeRevision(client, target.id, newVersion, newBody, input.label, committedOps, input.kind === "full");

  // transform presence offsets through the committed ops
  await transformPresence(client, target.id, committedOps, newBody);

  const baseVersion = input.baseVersion;
  await emitBlockSaved(client, target, newVersion, newBody, committedOps, baseVersion, input.editId, input.label);
  return { block: { ...target, body: newBody, version: newVersion }, ops: committedOps, baseVersion, conflict: false };
}

/** Shift the block's presence offsets through the committed edit. */
async function transformPresence(client: PoolClient, blockId: string, ops: Op[] | null, newBody: string): Promise<void> {
  const rows = await client.query<{ session_id: string; anchor: number | null; head: number | null }>(
    "SELECT session_id, anchor, head FROM presence WHERE block_id = $1",
    [blockId]
  );
  const newLen = editText(newBody).length;
  const shift = (offset: number): number => {
    if (ops === null) return Math.min(offset, newLen);
    let pos = 0;
    let result = offset;
    for (const op of ops) {
      if ("retain" in op) pos += op.retain;
      else if ("insert" in op) {
        if (pos <= offset) result += op.insert.length;
      } else {
        if (pos + op.delete <= offset) result -= op.delete;
        else if (pos < offset) result = pos;
        pos += op.delete;
      }
    }
    return Math.max(0, Math.min(result, newLen));
  };
  for (const row of rows.rows) {
    if (row.anchor === null || row.head === null) continue;
    const anchor = shift(row.anchor);
    const head = shift(row.head);
    await client.query("UPDATE presence SET anchor = $1, head = $2, updated_at = now() WHERE session_id = $3 AND block_id = $4", [anchor, head, row.session_id, blockId]);
  }
}

async function resolveOrigin(client: PoolClient, quoteBlock: BlockRow): Promise<BlockRow> {
  if (quoteBlock.origin_block_id === null) return quoteBlock;
  const origin = await loadBlock(client, quoteBlock.origin_block_id);
  if (origin === null) throw new BlockError("not_found");
  return origin;
}

export async function emitBlockSaved(client: PoolClient, target: BlockRow, newVersion: number, newBody: string, ops: Op[] | null, baseVersion: number, editId: string | null, label: string): Promise<void> {
  const quotes = await client.query<{ id: string; object_id: string; position: number }>(
    "SELECT id, object_id, position FROM blocks WHERE origin_block_id = $1 ORDER BY position",
    [target.id]
  );
  const originObj = await client.query<{ title: string }>("SELECT title FROM objects WHERE id = $1", [target.object_id]);
  const originTitle = originObj.rows[0]?.title ?? "";
  const backlinks = await backlinkCount(client, target.object_id);
  await recordEvent(client, "block.saved", {
    object_id: target.object_id,
    block: { id: target.id, object_id: target.object_id, kind: "text", position: target.position, body: newBody, version: newVersion, origin: null, attachment: null },
    ops,
    base_version: baseVersion,
    label,
    edit_id: editId,
  });
  for (const q of quotes.rows) {
    await recordEvent(client, "block.saved", {
      object_id: q.object_id,
      block: {
        id: q.id,
        object_id: q.object_id,
        kind: "quote",
        position: q.position,
        body: newBody,
        version: newVersion,
        origin: { block_id: target.id, object_id: target.object_id, object_title: originTitle, backlinks },
        attachment: null,
      },
      ops,
      base_version: baseVersion,
      label,
      edit_id: editId,
    });
  }
}

// ---------------------------------------------------------------------------
// Quotes

export interface QuoteResult {
  quoteBlockId: string;
  originBacklinks: number;
  position: number;
  hostObjectId: string;
  originObjectId: string;
  originTitle: string;
}

export async function createQuote(client: PoolClient, hostObjectId: string, originBlockId: string, afterBlockId: string | null, label: string): Promise<QuoteResult> {
  const origin = await loadBlock(client, originBlockId);
  if (origin === null) throw new BlockError("not_found");
  if (origin.kind === "quote") {
    const resolved = await resolveOrigin(client, origin);
    return createQuote(client, hostObjectId, resolved.id, afterBlockId, label);
  }
  if (origin.kind !== "text") throw new BlockError("validation", "origin_block_id", "Only text blocks can be quoted.");
  const host = await client.query<{ id: string; title: string }>("SELECT id, title FROM objects WHERE id = $1", [hostObjectId]);
  if (host.rows.length === 0) throw new BlockError("not_found");
  const originObj = await client.query<{ id: string; title: string }>("SELECT id, title FROM objects WHERE id = $1", [origin.object_id]);
  if (origin.object_id === hostObjectId) throw new BlockError("validation", "origin_block_id", "Quote a block from another note.");

  // position after the given block, else at the end
  let position: number;
  if (afterBlockId !== null) {
    const after = await client.query<{ position: number; object_id: string }>("SELECT position, object_id FROM blocks WHERE id = $1", [afterBlockId]);
    if (after.rows.length === 0 || after.rows[0].object_id !== hostObjectId) throw new BlockError("validation", "after_block_id", "That block is not in this note.");
    position = after.rows[0].position + 1;
  } else {
    const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [hostObjectId]);
    position = (max.rows[0].max ?? 0) + 1;
  }
  await client.query("UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position >= $2", [hostObjectId, position]);
  const quoteBlockId = randomUUID();
  await client.query(
    "INSERT INTO blocks (id, object_id, kind, position, body, version, origin_block_id, attachment_id, created_at, updated_at) VALUES ($1, $2, 'quote', $3, '', 1, $4, NULL, now(), now())",
    [quoteBlockId, hostObjectId, position, originBlockId]
  );
  await client.query(
    "INSERT INTO link_edges (from_object_id, to_object_id, kind, block_id, field_name, created_at) VALUES ($1, $2, 'quote', $3, NULL, now())",
    [hostObjectId, origin.object_id, quoteBlockId]
  );
  const backlinks = await backlinkCount(client, origin.object_id);
  await recordEvent(client, "object.saved", { object_id: hostObjectId });
  await recordEvent(client, "backlinks.changed", { object_id: origin.object_id, backlinks });
  const originTitle = originObj.rows[0].title;
  await emitBlockSavedForQuote(client, quoteBlockId, hostObjectId, origin, originTitle, backlinks);
  await touchObject(client, hostObjectId);
  return { quoteBlockId, originBacklinks: backlinks, position, hostObjectId, originObjectId: origin.object_id, originTitle };
}

async function emitBlockSavedForQuote(client: PoolClient, quoteBlockId: string, hostObjectId: string, origin: BlockRow, originTitle: string, backlinks: number): Promise<void> {
  const pos = await client.query<{ position: number }>("SELECT position FROM blocks WHERE id = $1", [quoteBlockId]);
  await recordEvent(client, "block.saved", {
    object_id: hostObjectId,
    block: { id: quoteBlockId, object_id: hostObjectId, kind: "quote", position: pos.rows[0].position, body: origin.body, version: origin.version, origin: { block_id: origin.id, object_id: origin.object_id, object_title: originTitle, backlinks }, attachment: null },
    ops: null,
    base_version: origin.version,
    label: "quote",
    edit_id: null,
  });
}

export async function removeQuote(client: PoolClient, quoteBlockId: string): Promise<{ originObjectId: string; originBacklinks: number; hostObjectId: string } | null> {
  const block = await loadBlock(client, quoteBlockId);
  if (block === null || block.kind !== "quote" || block.origin_block_id === null) return null;
  const origin = await loadBlock(client, block.origin_block_id);
  const originObjectId = origin !== null ? origin.object_id : block.object_id;
  await client.query("DELETE FROM blocks WHERE id = $1", [quoteBlockId]);
  await client.query("UPDATE blocks SET position = position - 1 WHERE object_id = $1 AND position > $2", [block.object_id, block.position]);
  await client.query("DELETE FROM link_edges WHERE block_id = $1", [quoteBlockId]);
  const originObjRow = await client.query<{ object_id: string }>("SELECT object_id FROM blocks WHERE id = $1", [block.origin_block_id]);
  const targetObjectId = originObjRow.rows.length > 0 ? originObjRow.rows[0].object_id : originObjectId;
  const backlinks = await backlinkCount(client, targetObjectId);
  await recordEvent(client, "block.removed", { object_id: block.object_id, block_id: quoteBlockId });
  await recordEvent(client, "backlinks.changed", { object_id: targetObjectId, backlinks });
  await touchObject(client, block.object_id);
  return { originObjectId: targetObjectId, originBacklinks: backlinks, hostObjectId: block.object_id };
}

export async function backlinkCount(client: PoolClient | PoolClient, objectId: string): Promise<number> {
  const res = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM link_edges WHERE to_object_id = $1", [objectId]);
  return Number(res.rows[0].n);
}

/** Quote count of a block: how many quote blocks quote it. */
export async function blockQuoteCount(client: PoolClient, blockId: string): Promise<number> {
  const res = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM blocks WHERE origin_block_id = $1", [blockId]);
  return Number(res.rows[0].n);
}

export async function touchObject(client: PoolClient, objectId: string): Promise<void> {
  await client.query("UPDATE objects SET updated_at = now() WHERE id = $1", [objectId]);
}

// ---------------------------------------------------------------------------
// Moving blocks

export interface MoveResult {
  block: BlockRow;
  fromObjectId: string;
  toObjectId: string;
}

export async function moveBlock(client: PoolClient, blockId: string, toObjectId: string, afterBlockId: string | null, label: string): Promise<MoveResult> {
  const block = await loadBlock(client, blockId);
  if (block === null) throw new BlockError("not_found");
  if (block.kind === "attachment") throw new BlockError("validation", "object_id", "That note no longer exists.");
  if (block.kind === "quote") {
    if (block.origin_block_id !== null) {
      const origin = await loadBlock(client, block.origin_block_id);
      if (origin !== null && origin.object_id === toObjectId) throw new BlockError("validation", "object_id", "Quote a block from another note.");
    }
  }
  if (block.kind === "text") {
    const quoted = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM blocks WHERE origin_block_id = $1 AND object_id = $2", [blockId, toObjectId]);
    if (Number(quoted.rows[0].n) > 0) throw new BlockError("validation", "object_id", "That note quotes this block.");
  }
  const toObj = await client.query("SELECT id FROM objects WHERE id = $1", [toObjectId]);
  if (toObj.rows.length === 0) throw new BlockError("validation", "object_id", "That note no longer exists.");
  if (block.object_id === toObjectId) {
    // move within the same object: reposition
    await repositionWithin(client, block, afterBlockId);
  } else {
    await client.query("UPDATE blocks SET position = position - 1 WHERE object_id = $1 AND position > $2", [block.object_id, block.position]);
    let position: number;
    if (afterBlockId !== null) {
      const after = await client.query<{ position: number; object_id: string }>("SELECT position, object_id FROM blocks WHERE id = $1", [afterBlockId]);
      if (after.rows.length === 0) {
        const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [toObjectId]);
        position = (max.rows[0].max ?? 0) + 1;
      } else if (after.rows[0].object_id !== toObjectId) {
        const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [toObjectId]);
        position = (max.rows[0].max ?? 0) + 1;
      } else {
        position = after.rows[0].position + 1;
        await client.query("UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position >= $2", [toObjectId, position]);
      }
    } else {
      const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [toObjectId]);
      position = (max.rows[0].max ?? 0) + 1;
    }
    await client.query("UPDATE blocks SET object_id = $1, position = $2, updated_at = now() WHERE id = $3", [toObjectId, position, blockId]);
    // edge updates
    await client.query("UPDATE link_edges SET from_object_id = $1 WHERE block_id = $2", [toObjectId, blockId]);
    if (block.kind === "text") {
      await client.query("UPDATE link_edges SET to_object_id = $1 WHERE block_id IN (SELECT id FROM blocks WHERE origin_block_id = $2)", [toObjectId, blockId]);
    }
    // refresh counts for both objects
    const fromCount = await backlinkCount(client, block.object_id);
    const toCount = await backlinkCount(client, toObjectId);
    await recordEvent(client, "block.removed", { object_id: block.object_id, block_id: blockId });
    const moved = await loadBlock(client, blockId);
    await recordEvent(client, "block.saved", {
      object_id: toObjectId,
      block: { id: blockId, object_id: toObjectId, kind: block.kind, position, body: moved?.body ?? "", version: moved?.version ?? 1, origin: null, attachment: null },
      ops: null,
      base_version: moved?.version ?? 1,
      label,
      edit_id: null,
    });
    await recordEvent(client, "backlinks.changed", { object_id: block.object_id, backlinks: fromCount });
    await recordEvent(client, "backlinks.changed", { object_id: toObjectId, backlinks: toCount });
    await touchObject(client, toObjectId);
    const result = await loadBlock(client, blockId);
    return { block: result ?? block, fromObjectId: block.object_id, toObjectId };
  }
  const result = await loadBlock(client, blockId);
  await recordEvent(client, "block.saved", {
    object_id: block.object_id,
    block: { id: blockId, object_id: block.object_id, kind: block.kind, position: result?.position ?? block.position, body: result?.body ?? block.body, version: result?.version ?? block.version, origin: null, attachment: null },
    ops: null,
    base_version: result?.version ?? block.version,
    label,
    edit_id: null,
  });
  await touchObject(client, block.object_id);
  return { block: result ?? block, fromObjectId: block.object_id, toObjectId };
}

async function repositionWithin(client: PoolClient, block: BlockRow, afterBlockId: string | null): Promise<void> {
  await client.query("UPDATE blocks SET position = position - 1 WHERE object_id = $1 AND position > $2", [block.object_id, block.position]);
  let position: number;
  if (afterBlockId !== null) {
    const after = await client.query<{ position: number }>("SELECT position FROM blocks WHERE id = $1 AND object_id = $2", [afterBlockId, block.object_id]);
    if (after.rows.length === 0) {
      const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [block.object_id]);
      position = (max.rows[0].max ?? 0) + 1;
    } else {
      position = after.rows[0].position + 1;
    }
  } else {
    const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [block.object_id]);
    position = (max.rows[0].max ?? 0) + 1;
  }
  await client.query("UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position >= $2 AND id <> $3", [block.object_id, position, block.id]);
  await client.query("UPDATE blocks SET position = $1 WHERE id = $2", [position, block.id]);
}

// ---------------------------------------------------------------------------
// Creating and deleting blocks

export async function createTextBlock(client: PoolClient, objectId: string, body: string, afterBlockId: string | null, label: string): Promise<BlockRow> {
  const stored = sanitizeBody(body);
  if (stored.length > BLOCK_BODY_CAP) throw new BlockError("validation", "body", "A block can hold at most 20,000 characters.");
  let position: number;
  if (afterBlockId !== null) {
    const after = await client.query<{ position: number; object_id: string }>("SELECT position, object_id FROM blocks WHERE id = $1", [afterBlockId]);
    if (after.rows.length === 0 || after.rows[0].object_id !== objectId) throw new BlockError("validation", "after_block_id", "That block is not in this note.");
    position = after.rows[0].position + 1;
    await client.query("UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position >= $2", [objectId, position]);
  } else {
    const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [objectId]);
    position = (max.rows[0].max ?? 0) + 1;
  }
  const id = randomUUID();
  await client.query(
    "INSERT INTO blocks (id, object_id, kind, position, body, version, origin_block_id, attachment_id, created_at, updated_at) VALUES ($1, $2, 'text', $3, $4, 1, NULL, NULL, now(), now())",
    [id, objectId, position, stored]
  );
  await storeRevision(client, id, 1, stored, label, null, true);
  await recordEvent(client, "block.saved", {
    object_id: objectId,
    block: { id, object_id: objectId, kind: "text", position, body: stored, version: 1, origin: null, attachment: null },
    ops: null,
    base_version: 0,
    label,
    edit_id: null,
  });
  await touchObject(client, objectId);
  return { id, object_id: objectId, kind: "text", position, body: stored, version: 1, origin_block_id: null, attachment_id: null };
}

export interface DeleteBlockResult {
  objectId: string;
  wasQuote: boolean;
  originObjectId: string | null;
  originBacklinks: number;
}

export async function deleteTextBlock(client: PoolClient, blockId: string): Promise<DeleteBlockResult> {
  const block = await loadBlock(client, blockId);
  if (block === null) throw new BlockError("not_found");
  if (block.kind === "quote") {
    const res = await removeQuote(client, blockId);
    if (res === null) throw new BlockError("not_found");
    return { objectId: block.object_id, wasQuote: true, originObjectId: res.originObjectId, originBacklinks: res.originBacklinks };
  }
  const quoted = await blockQuoteCount(client, blockId);
  if (quoted > 0) throw new BlockError("block_quoted", undefined, undefined, { quoted_in: quoted });
  await client.query("DELETE FROM blocks WHERE id = $1", [blockId]);
  await client.query("UPDATE blocks SET position = position - 1 WHERE object_id = $1 AND position > $2", [block.object_id, block.position]);
  await recordEvent(client, "block.removed", { object_id: block.object_id, block_id: blockId });
  await touchObject(client, block.object_id);
  return { objectId: block.object_id, wasQuote: false, originObjectId: null, originBacklinks: 0 };
}

/** Full delete of an object and all its entanglements, in one transaction. */
export async function deleteObjectEntirely(client: PoolClient, objectId: string, s3Delete: (attachmentKey: string) => void): Promise<void> {
  const blocks = await client.query<{ id: string; attachment_id: string | null }>("SELECT id, attachment_id FROM blocks WHERE object_id = $1", [objectId]);
  for (const b of blocks.rows) {
    if (b.attachment_id !== null) s3Delete(`attachments/${objectId}/${b.attachment_id}`);
  }
  // quote blocks elsewhere whose origin was one of this object's blocks
  const quotes = await client.query<{ id: string; object_id: string }>(
    `SELECT q.id, q.object_id FROM blocks q
     JOIN blocks o ON q.origin_block_id = o.id
     WHERE o.object_id = $1 AND q.object_id <> $1`,
    [objectId]
  );
  // relation values that point at this object
  const fieldRows = await client.query<{ object_id: string }>(
    `SELECT DISTINCT p.object_id FROM properties p
     JOIN objects o ON o.id = p.object_id
     JOIN type_fields f ON f.type_id = o.type_id AND f.name = p.field_name
     WHERE f.kind = 'relation' AND p.value = to_jsonb($1::text)`,
    [objectId]
  );
  const affected = fieldRows.rows.map((r) => r.object_id);
  await client.query(
    `UPDATE properties p SET value = NULL
     FROM objects o, type_fields f
     WHERE p.object_id = o.id AND f.type_id = o.type_id AND f.name = p.field_name
       AND f.kind = 'relation' AND p.value = to_jsonb($1::text)`,
    [objectId]
  );
  await client.query("DELETE FROM link_edges WHERE kind = 'relation' AND to_object_id = $1", [objectId]);
  await client.query("DELETE FROM objects WHERE id = $1", [objectId]);
  await recordEvent(client, "object.removed", { object_id: objectId });
  for (const q of quotes.rows) {
    await recordEvent(client, "block.removed", { object_id: q.object_id, block_id: q.id });
  }
  for (const other of affected) {
    if (other !== objectId) {
      await touchObject(client, other);
      await recordEvent(client, "object.saved", { object_id: other });
    }
  }
}
