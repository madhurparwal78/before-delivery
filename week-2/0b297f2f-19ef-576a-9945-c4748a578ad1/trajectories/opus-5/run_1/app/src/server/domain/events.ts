import type { PoolClient } from 'pg';
import type { EventKind } from '../../shared/types';

export interface EventInput {
  kind: EventKind;
  actorId: string | null;
  placementId?: string | null;
  objectId?: string | null;
  wallId?: string | null;
  previewId?: string | null;
  title?: string | null;
  wallName?: string | null;
  offsetMm?: number | null;
  plannedLux?: number | null;
  publishAtDisplay?: string | null;
  recipientCount?: number | null;
}

/**
 * Writes the one event for a change, in the change's own transaction. The counter row is
 * locked for the rest of the transaction, so seq order is commit order.
 */
export async function writeEvent(client: PoolClient, input: EventInput): Promise<number> {
  const seqRow = (
    await client.query('update event_counter set value = value + 1 where id = 1 returning value')
  ).rows[0] as { value: string } | undefined;
  if (!seqRow) throw new Error('event counter missing');
  const seq = Number(seqRow.value);
  await client.query(
    `insert into events (seq, kind, actor_id, placement_id, object_id, wall_id, preview_id,
       title, wall_name, offset_mm, planned_lux, publish_at_display, recipient_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      seq,
      input.kind,
      input.actorId,
      input.placementId ?? null,
      input.objectId ?? null,
      input.wallId ?? null,
      input.previewId ?? null,
      input.title ?? null,
      input.wallName ?? null,
      input.offsetMm ?? null,
      input.plannedLux ?? null,
      input.publishAtDisplay ?? null,
      input.recipientCount ?? null,
    ],
  );
  return seq;
}

export async function latestSeq(client: PoolClient): Promise<number> {
  const row = (await client.query('select value from event_counter where id = 1')).rows[0] as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}
