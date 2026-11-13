import { formatTimestamp } from '../shared/clock.js';
import { packetLabel, survivesCitationDelete } from '../shared/packet-state.js';
import type { Packet, PacketFailure, PacketPdf, PacketRow, PacketState } from '../shared/types.js';
import { pool, type Queryable } from './db.js';
import { notFound } from './errors.js';

export interface PacketRecord {
  id: string;
  account_id: string;
  number: number;
  program_id: string;
  state: PacketState;
  revision: number;
  pdf: PacketPdf | null;
  failure: PacketFailure | null;
  sent_at: Date | null;
  returned_to_draft: boolean;
  render_attempt: string | null;
  created_at: Date;
  observation_ids: string[];
  rows: PacketRow[];
}

const PACKET_QUERY = `
  SELECT p.id, p.account_id, p.number, p.program_id, p.state, p.revision, p.pdf, p.failure,
    p.sent_at, p.returned_to_draft, p.render_attempt, p.created_at,
    COALESCE((
      SELECT json_agg(po.observation_id ORDER BY po.position)
      FROM packet_order po WHERE po.packet_id = p.id
    ), '[]'::json) AS observation_ids,
    COALESCE((
      SELECT json_agg(json_build_object(
        'observation_id', ps.observation_id,
        'designation', ps.designation,
        'evening_date', ps.evening_date,
        'edition', ps.edition,
        'strokes_sha256', ps.strokes_sha256
      ) ORDER BY ps.position)
      FROM packet_snapshot ps WHERE ps.packet_id = p.id
    ), '[]'::json) AS rows
  FROM packets p`;

export function toPacket(record: PacketRecord): Packet {
  return {
    id: record.id,
    number: record.number,
    program_id: record.program_id,
    state: record.state,
    label: packetLabel(record.state),
    revision: record.revision,
    observation_ids: record.observation_ids,
    rows: record.rows,
    pdf: record.pdf,
    failure: record.failure,
    sent_at: record.sent_at ? formatTimestamp(record.sent_at) : null,
    returned_to_draft: record.returned_to_draft,
    created_at: formatTimestamp(record.created_at),
  };
}

export async function readPacketRecord(
  accountId: string,
  packetId: string,
  client: Queryable = pool,
): Promise<PacketRecord> {
  const found = await client.query<PacketRecord>(
    `${PACKET_QUERY} WHERE p.account_id = $1 AND p.id = $2`,
    [accountId, packetId],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export async function readPacketRecordById(
  packetId: string,
  client: Queryable = pool,
): Promise<PacketRecord | null> {
  const found = await client.query<PacketRecord>(`${PACKET_QUERY} WHERE p.id = $1`, [packetId]);
  return found.rows[0] ?? null;
}

export async function listPacketRecords(
  accountId: string,
  client: Queryable = pool,
): Promise<PacketRecord[]> {
  const found = await client.query<PacketRecord>(
    `${PACKET_QUERY} WHERE p.account_id = $1 ORDER BY p.created_at DESC, p.number DESC`,
    [accountId],
  );
  return found.rows;
}

export async function lockPacket(client: Queryable, packetId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packet:${packetId}`]);
}

const DRAFT_RETURN_STATES: readonly PacketState[] = [
  'checked',
  'rendering',
  'rendered',
  'render_failed',
  'send_failed',
];

/**
 * An applied observation change returns every citing packet that has not started
 * sending to draft, in one revision step each.
 */
export async function returnCitingPacketsToDraft(
  client: Queryable,
  accountId: string,
  observationId: string,
): Promise<void> {
  await client.query(
    `UPDATE packets SET state = 'draft', pdf = NULL, failure = NULL, returned_to_draft = true,
       render_attempt = NULL, render_started_at = NULL, revision = revision + 1
     WHERE account_id = $1 AND state = ANY($2::text[])
       AND id IN (SELECT packet_id FROM packet_order WHERE observation_id = $3)`,
    [accountId, DRAFT_RETURN_STATES, observationId],
  );
  await client.query(
    `DELETE FROM packet_snapshot WHERE packet_id IN (
       SELECT packet_id FROM packet_order WHERE observation_id = $1
     ) AND packet_id IN (SELECT id FROM packets WHERE account_id = $2 AND state = 'draft')`,
    [observationId, accountId],
  );
}

export interface CitingPacket {
  id: string;
  state: PacketState;
}

export async function citingPackets(
  client: Queryable,
  accountId: string,
  observationId: string,
): Promise<CitingPacket[]> {
  const found = await client.query<CitingPacket>(
    `SELECT p.id, p.state FROM packets p
     JOIN packet_order po ON po.packet_id = p.id
     WHERE p.account_id = $1 AND po.observation_id = $2`,
    [accountId, observationId],
  );
  return found.rows;
}

export function citedBySendingOrSent(packets: CitingPacket[]): boolean {
  return packets.some((packet) => survivesCitationDelete(packet.state));
}

export async function onlyRowOfPacket(
  client: Queryable,
  accountId: string,
  observationId: string,
): Promise<boolean> {
  const found = await client.query<{ packet_id: string }>(
    `SELECT po.packet_id FROM packet_order po
     JOIN packets p ON p.id = po.packet_id
     WHERE p.account_id = $1 AND po.observation_id = $2
       AND (SELECT count(*) FROM packet_order x WHERE x.packet_id = po.packet_id) = 1`,
    [accountId, observationId],
  );
  return (found.rowCount ?? 0) > 0;
}
