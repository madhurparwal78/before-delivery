import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import type { FieldEditMap } from './field-resolution.js';
import {
  citedBySendingOrSent,
  citingPackets,
  onlyRowOfPacket,
} from './packet-store.js';
import {
  deleteObject,
  listObjects,
  observationSketchPrefixes,
  packetPrefix,
  StorageDown,
} from './storage.js';
import { query } from './db.js';

/**
 * The one place an observation delete is decided, in the published order:
 * ownership, already deleted, cited by a sent packet, the only row of a packet,
 * edited since, the storage listing, then the tombstone.
 */
export interface DeleteDecision {
  prefixes: string[];
  packetIds: string[];
}

export function refuseWith(code: string, observation: unknown): ApiError {
  return new ApiError(409, code, { observation });
}

export function editedSinceAnotherDevice(
  edits: FieldEditMap,
  device: string,
  baseVersion: number,
): boolean {
  for (const state of edits.values()) {
    if (state.device !== device && state.set_at_version > baseVersion) return true;
  }
  return false;
}

export async function refusalsForDelete(
  client: PoolClient,
  accountId: string,
  observationId: string,
): Promise<'cited_by_sent_packet' | 'only_row_of_packet' | null> {
  const citing = await citingPackets(client, accountId, observationId);
  if (citedBySendingOrSent(citing)) return 'cited_by_sent_packet';
  if (await onlyRowOfPacket(client, accountId, observationId)) return 'only_row_of_packet';
  return null;
}

/** List everything the delete must remove. A storage outage here changes nothing. */
export async function listRemovals(
  client: PoolClient,
  accountId: string,
  observationId: string,
): Promise<DeleteDecision> {
  const citing = await citingPackets(client, accountId, observationId);
  const prefixes = [
    ...observationSketchPrefixes(accountId, observationId),
    ...citing.map((packet) => packetPrefix(accountId, packet.id)),
  ];
  const keys: string[] = [];
  for (const prefix of prefixes) {
    keys.push(...(await listObjects(prefix)));
  }
  return { prefixes: keys, packetIds: citing.map((packet) => packet.id) };
}

const DRAFT_RETURN_STATES = ['checked', 'rendering', 'rendered', 'render_failed', 'send_failed'];

/** The tombstone: final, in one revision step per citing packet. */
export async function tombstone(
  client: PoolClient,
  accountId: string,
  observationId: string,
  packetIds: string[],
): Promise<void> {
  await client.query(
    `UPDATE observations SET deleted = true, version = version + 1
     WHERE account_id = $1 AND id = $2`,
    [accountId, observationId],
  );
  await client.query('DELETE FROM packet_order WHERE observation_id = $1', [observationId]);
  if (packetIds.length > 0) {
    await client.query(
      `UPDATE packets SET
         state = CASE WHEN state = ANY($2::text[]) THEN 'draft' ELSE state END,
         pdf = CASE WHEN state = ANY($2::text[]) THEN NULL ELSE pdf END,
         failure = CASE WHEN state = ANY($2::text[]) THEN NULL ELSE failure END,
         returned_to_draft = CASE WHEN state = ANY($2::text[]) THEN true ELSE returned_to_draft END,
         render_attempt = NULL,
         render_started_at = NULL,
         revision = revision + 1
       WHERE id = ANY($1::uuid[])`,
      [packetIds, DRAFT_RETURN_STATES],
    );
    await client.query('DELETE FROM packet_snapshot WHERE packet_id = ANY($1::uuid[])', [
      packetIds,
    ]);
    await client.query(
      `UPDATE packet_order po SET position = ranked.rank - 1
       FROM (
         SELECT packet_id, observation_id, row_number() OVER (PARTITION BY packet_id ORDER BY position) AS rank
         FROM packet_order WHERE packet_id = ANY($1::uuid[])
       ) ranked
       WHERE po.packet_id = ranked.packet_id AND po.observation_id = ranked.observation_id`,
      [packetIds],
    );
  }
}

/** Remove the listed objects, queueing a retry for anything storage refuses. */
export async function removeObjects(keys: string[], prefixes: string[]): Promise<void> {
  try {
    for (const key of keys) await deleteObject(key);
  } catch (error) {
    if (!(error instanceof StorageDown)) throw error;
    for (const prefix of prefixes) {
      await query('INSERT INTO storage_removals (prefix) VALUES ($1)', [prefix]);
    }
  }
}
