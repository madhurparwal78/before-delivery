// Link edges: quote and relation edges, the counts they drive, and their live sync events.
import { randomUUID } from 'node:crypto';
import type { Tx } from './db.ts';
import { emit } from './events.ts';
import { backlinkCount } from './model.ts';

/**
 * Locks the objects whose counts an edge change touches, in id order, so concurrent quotes
 * of one origin commit one after another and each sees the count its own quote made.
 */
export async function lockObjects(tx: Tx, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length) await tx.query('SELECT id FROM objects WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [sorted]);
}

/** Emits `backlinks.changed` with the committed count for each object. */
export async function announceCounts(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of [...new Set(ids)]) {
    const exists = await tx.query('SELECT 1 FROM objects WHERE id = $1', [id]);
    if (!exists.length) continue;
    const n = await backlinkCount(tx, id);
    counts.set(id, n);
    await emit(tx, 'backlinks.changed', { object_id: id, backlinks: n });
  }
  return counts;
}

export async function addQuoteEdge(tx: Tx, hostId: string, originObjectId: string, quoteBlockId: string): Promise<void> {
  await tx.query(
    `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, quote_block_id, created_at) VALUES ($1, $2, $3, 'quote', $4, clock_timestamp())`,
    [randomUUID(), hostId, originObjectId, quoteBlockId]);
}

/** Replaces the relation edge of one field; returns the objects whose counts changed. */
export async function setRelationEdge(tx: Tx, objectId: string, field: string, target: string | null): Promise<string[]> {
  const old = await tx.query<{ to_object_id: string }>(
    `DELETE FROM link_edges WHERE from_object_id = $1 AND kind = 'relation' AND field_name = $2 RETURNING to_object_id`, [objectId, field]);
  if (target) {
    await tx.query(
      `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, field_name, created_at) VALUES ($1, $2, $3, 'relation', $4, clock_timestamp())`,
      [randomUUID(), objectId, target, field]);
  }
  return [...old.map((r) => r.to_object_id), ...(target ? [target] : [])];
}
