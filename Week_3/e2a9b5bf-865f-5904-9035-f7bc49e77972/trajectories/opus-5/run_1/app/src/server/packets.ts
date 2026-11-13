import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { completenessFailures, editionFor } from '../shared/completeness.js';
import { PACKET_REASON_MESSAGES } from '../shared/messages.js';
import { actionIsLegal, type PacketAction } from '../shared/packet-state.js';
import type { PacketPage } from '../shared/packet-page.js';
import type { Packet, PacketReason } from '../shared/types.js';
import type { Account } from '../shared/types.js';
import { query, withTransaction } from './db.js';
import { ApiError, FieldErrors, notFound, storageUnavailable } from './errors.js';
import { readKit } from './kit.js';
import {
  listPacketRecords,
  lockPacket,
  readPacketRecord,
  readPacketRecordById,
  toPacket,
  type PacketRecord,
} from './packet-store.js';
import { coverPage, packetDocument, readSnapshotSketch, rowPage } from './packet-pages.js';
import { programRules, readProgramRecord, type ProgramRecord } from './programs.js';
import { readObservations, toCompletenessSubject, type ObservationRow } from './records.js';
import { countPdfPages, renderHtmlToPdf } from './renderer.js';
import { sendMail, SmtpDown, SmtpRejected } from './smtp.js';
import {
  deleteObject,
  getObject,
  headObjectSize,
  listObjects,
  packetPdfKey,
  packetPrefix,
  putObject,
  StorageDown,
  strokesKey,
} from './storage.js';

const MAX_ROWS = 200;

function readRevision(body: Record<string, unknown>): number {
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    new FieldErrors().add('revision').throwIfAny();
  }
  return revision as number;
}

function readObservationIds(body: Record<string, unknown>): string[] {
  const ids = body.observation_ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_ROWS ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids as string[]).size !== ids.length
  ) {
    new FieldErrors().add('observation_ids').throwIfAny();
  }
  return ids as string[];
}

async function ownedObservations(
  client: PoolClient,
  accountId: string,
  ids: string[],
): Promise<void> {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM observations WHERE account_id = $1 AND deleted = false AND id = ANY($2::uuid[])',
    [accountId, ids],
  );
  if (found.rowCount !== ids.length) throw notFound();
}

async function writeOrder(
  client: PoolClient,
  packetId: string,
  observationIds: string[],
): Promise<void> {
  await client.query('DELETE FROM packet_order WHERE packet_id = $1', [packetId]);
  for (const [position, observationId] of observationIds.entries()) {
    await client.query(
      'INSERT INTO packet_order (packet_id, position, observation_id) VALUES ($1,$2,$3)',
      [packetId, position, observationId],
    );
  }
}

/** Packet numbers count up from 1 for each observer, with no gaps. */
async function nextPacketNumber(client: PoolClient, accountId: string): Promise<number> {
  const updated = await client.query<{ number: number }>(
    `INSERT INTO packet_counters (account_id, next_number) VALUES ($1, 2)
     ON CONFLICT (account_id) DO UPDATE SET next_number = packet_counters.next_number + 1
     RETURNING next_number - 1 AS number`,
    [accountId],
  );
  const number = updated.rows[0]?.number;
  if (number === undefined) throw new Error('the packet counter always returns a number');
  return number;
}

export async function createPacket(
  accountId: string,
  body: Record<string, unknown>,
): Promise<Packet> {
  const programId = body.program_id;
  if (typeof programId !== 'string') new FieldErrors().add('program_id').throwIfAny();
  await readProgramRecord(programId as string);
  const observationIds = readObservationIds(body);

  return withTransaction(async (client) => {
    await ownedObservations(client, accountId, observationIds);
    const id = randomUUID();
    const number = await nextPacketNumber(client, accountId);
    await client.query(
      `INSERT INTO packets (id, account_id, number, program_id, state, revision, returned_to_draft)
       VALUES ($1,$2,$3,$4,'draft',1,false)`,
      [id, accountId, number, programId],
    );
    await writeOrder(client, id, observationIds);
    return toPacket(await readPacketRecord(accountId, id, client));
  });
}

export async function listPackets(accountId: string): Promise<Packet[]> {
  return (await listPacketRecords(accountId)).map(toPacket);
}

export async function getPacket(accountId: string, packetId: string): Promise<Packet> {
  return toPacket(await readPacketRecord(accountId, packetId));
}

function guard(record: PacketRecord, action: PacketAction, revision: number): void {
  if (!actionIsLegal(record.state, action)) {
    throw new ApiError(409, 'invalid_transition', { state: record.state });
  }
  if (record.revision !== revision) {
    throw new ApiError(412, 'stale_revision', { packet: toPacket(record) });
  }
}

export async function replaceRows(
  accountId: string,
  packetId: string,
  body: Record<string, unknown>,
): Promise<Packet> {
  const revision = readRevision(body);
  const observationIds = readObservationIds(body);
  return withTransaction(async (client) => {
    await lockPacket(client, packetId);
    const record = await readPacketRecord(accountId, packetId, client);
    guard(record, 'rows', revision);
    await ownedObservations(client, accountId, observationIds);
    await writeOrder(client, packetId, observationIds);
    await client.query('DELETE FROM packet_snapshot WHERE packet_id = $1', [packetId]);
    await client.query(
      `UPDATE packets SET state = 'draft', pdf = NULL, failure = NULL, returned_to_draft = false,
         render_attempt = NULL, render_started_at = NULL, revision = revision + 1
       WHERE id = $1`,
      [packetId],
    );
    return toPacket(await readPacketRecord(accountId, packetId, client));
  });
}

interface CheckRow {
  observation: ObservationRow;
  edition: number;
  reasons: PacketReason[];
}

function checkRows(
  observations: Map<string, ObservationRow>,
  order: string[],
  program: ProgramRecord,
): CheckRow[] {
  const rules = programRules(program);
  const seenObjects = new Set<string>();
  const rows: CheckRow[] = [];
  for (const observationId of order) {
    const observation = observations.get(observationId);
    if (!observation) continue;
    const subject = toCompletenessSubject(observation);
    const edition = editionFor(program.editions, subject.evening_date);
    const date = subject.evening_date;
    const designation = observation.designation;
    const reasons: PacketReason[] = [];
    const failures = completenessFailures(subject, rules);
    if (failures[0] === 'not_on_program') {
      reasons.push({
        observation_id: observationId,
        code: 'not_on_program',
        message: PACKET_REASON_MESSAGES.not_on_program(designation, date),
      });
    } else {
      if (seenObjects.has(subject.object_id)) {
        reasons.push({
          observation_id: observationId,
          code: 'duplicate_object',
          message: PACKET_REASON_MESSAGES.duplicate_object(designation, date),
        });
      }
      for (const failure of failures) {
        reasons.push({
          observation_id: observationId,
          code: failure,
          message:
            failure === 'short_description'
              ? PACKET_REASON_MESSAGES.short_description(
                  designation,
                  date,
                  edition.min_description,
                )
              : PACKET_REASON_MESSAGES[failure](designation, date),
        });
      }
    }
    seenObjects.add(subject.object_id);
    rows.push({ observation, edition: edition.edition, reasons });
  }
  return rows;
}

export async function checkPacket(
  accountId: string,
  packetId: string,
  body: Record<string, unknown>,
): Promise<Packet> {
  const revision = readRevision(body);
  return withTransaction(async (client) => {
    await lockPacket(client, packetId);
    const record = await readPacketRecord(accountId, packetId, client);
    guard(record, 'check', revision);
    const program = await readProgramRecord(record.program_id, client);
    // Hold the cited observations so no applied edit can slip past the snapshot.
    for (const observationId of [...record.observation_ids].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `observation:${observationId}`,
      ]);
    }
    const rowsById = new Map<string, ObservationRow>();
    for (const row of await readObservations(accountId, client)) rowsById.set(row.id, row);

    const rows = checkRows(rowsById, record.observation_ids, program);
    const reasons = rows.flatMap((row) => row.reasons);
    const passingObjects = new Set(
      rows.filter((row) => row.reasons.length === 0).map((row) => row.observation.object_id),
    );
    if (passingObjects.size < program.required_count) {
      reasons.push({
        observation_id: null,
        code: 'too_few',
        message: PACKET_REASON_MESSAGES.too_few(passingObjects.size, program.required_count),
      });
    }
    if (reasons.length > 0) throw new ApiError(422, 'incomplete', { reasons });

    await client.query('DELETE FROM packet_snapshot WHERE packet_id = $1', [packetId]);
    for (const [position, row] of rows.entries()) {
      const subject = toCompletenessSubject(row.observation);
      await client.query(
        `INSERT INTO packet_snapshot (packet_id, position, observation_id, designation,
            evening_date, edition, strokes_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          packetId,
          position,
          row.observation.id,
          row.observation.designation,
          subject.evening_date,
          row.edition,
          row.observation.strokes_has_marks ? row.observation.strokes_sha256 : null,
        ],
      );
    }
    await client.query(
      `UPDATE packets SET state = 'checked', revision = revision + 1, returned_to_draft = false,
         failure = NULL WHERE id = $1`,
      [packetId],
    );
    return toPacket(await readPacketRecord(accountId, packetId, client));
  });
}

export async function startRender(
  account: Account,
  packetId: string,
  body: Record<string, unknown>,
): Promise<Packet> {
  const revision = readRevision(body);
  const attempt = randomUUID();
  const packet = await withTransaction(async (client) => {
    await lockPacket(client, packetId);
    const record = await readPacketRecord(account.id, packetId, client);
    guard(record, 'render', revision);
    await client.query(
      `UPDATE packets SET state = 'rendering', failure = NULL, pdf = NULL,
         render_attempt = $2, render_started_at = now(), revision = revision + 1
       WHERE id = $1`,
      [packetId, attempt],
    );
    return toPacket(await readPacketRecord(account.id, packetId, client));
  });
  void runRenderAttempt(account, packetId, attempt);
  return packet;
}

async function finishRender(
  packetId: string,
  attempt: string,
  apply: (client: PoolClient, record: PacketRecord) => Promise<void>,
): Promise<boolean> {
  return withTransaction(async (client) => {
    await lockPacket(client, packetId);
    const record = await readPacketRecordById(packetId, client);
    // A result applies only to the attempt that started it.
    if (!record || record.state !== 'rendering' || record.render_attempt !== attempt) return false;
    await apply(client, record);
    return true;
  });
}

async function runRenderAttempt(
  account: Account,
  packetId: string,
  attempt: string,
): Promise<void> {
  try {
    const record = await readPacketRecord(account.id, packetId);
    const program = await readProgramRecord(record.program_id);
    const kit = await readKit(account.id);
    const observations = new Map<string, ObservationRow>();
    for (const row of await readObservations(account.id)) observations.set(row.id, row);

    const pages: PacketPage[] = [coverPage(record, program, account, record.rows.length)];
    for (const snapshot of record.rows) {
      const observation = observations.get(snapshot.observation_id);
      if (!observation) throw new Error('a snapshotted row always has its observation');
      const sketch = await readSnapshotSketch(
        account.id,
        snapshot.observation_id,
        snapshot.strokes_sha256,
      );
      pages.push(rowPage(observation, snapshot.edition, kit, sketch));
    }

    const html = await packetDocument(pages);
    const bytes = await renderHtmlToPdf(html);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = packetPdfKey(account.id, packetId, sha256);
    await putObject(key, bytes, 'application/pdf');
    // Rendered only once a follow-up read confirms the stored size and checksum.
    const storedSize = await headObjectSize(key);
    const storedBytes = await getObject(key);
    const storedSha = createHash('sha256').update(storedBytes).digest('hex');
    if (storedSize !== bytes.byteLength || storedSha !== sha256) {
      throw new StorageDown('storage did not confirm the PDF');
    }
    const pages_count = countPdfPages(bytes);

    const applied = await finishRender(packetId, attempt, async (client) => {
      await client.query(
        `UPDATE packets SET state = 'rendered', failure = NULL,
           pdf = $2, render_attempt = NULL, render_started_at = NULL, revision = revision + 1
         WHERE id = $1`,
        [packetId, JSON.stringify({ size: bytes.byteLength, sha256, pages: pages_count })],
      );
    });
    if (applied) {
      // The packet holds exactly one stored PDF.
      for (const other of await listObjects(packetPrefix(account.id, packetId))) {
        if (other !== key) await deleteObject(other);
      }
    } else {
      await deleteObject(key).catch(() => undefined);
    }
  } catch (error) {
    const failure = error instanceof StorageDown ? 'storage_unavailable' : 'renderer_unavailable';
    await finishRender(packetId, attempt, async (client) => {
      await client.query(
        `UPDATE packets SET state = 'render_failed', failure = $2,
           render_attempt = NULL, render_started_at = NULL, revision = revision + 1
         WHERE id = $1`,
        [packetId, failure],
      );
    });
  }
}

/** A render whose instance went away must not hold a packet in rendering for ever. */
export async function sweepStalledRenders(): Promise<void> {
  await query(
    `UPDATE packets SET state = 'render_failed', failure = 'renderer_unavailable',
       render_attempt = NULL, render_started_at = NULL, revision = revision + 1
     WHERE state = 'rendering' AND render_started_at < now() - interval '60 seconds'`,
  ).catch(() => undefined);
}

export async function sendPacket(
  account: Account,
  packetId: string,
  body: Record<string, unknown>,
): Promise<Packet> {
  const revision = readRevision(body);
  const entered = await withTransaction(async (client) => {
    await lockPacket(client, packetId);
    const record = await readPacketRecord(account.id, packetId, client);
    guard(record, 'send', revision);
    if (!record.pdf) throw new Error('a rendered packet always holds its stored PDF');
    await client.query(
      `UPDATE packets SET state = 'sending', failure = NULL, revision = revision + 1 WHERE id = $1`,
      [packetId],
    );
    return { ...record, pdf: record.pdf };
  });

  const rollback = async (): Promise<void> => {
    await query('UPDATE packets SET state = $2, revision = $3 WHERE id = $1', [
      packetId,
      entered.state,
      entered.revision,
    ]);
  };

  let bytes: Uint8Array;
  try {
    // Sending reads the stored PDF before contacting SMTP.
    bytes = await getObject(packetPdfKey(account.id, packetId, entered.pdf.sha256));
  } catch (error) {
    await rollback();
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }

  const program = await readProgramRecord(entered.program_id);
  const filename = `lowlamp-packet-${entered.number}.pdf`;
  try {
    await sendMail({
      to: { name: program.coordinator_name, address: program.coordinator_email },
      cc: account.email,
      subject: `Observing log packet ${entered.number}: ${program.name} — ${account.display_name}`,
      text:
        `Please find attached observing log packet ${entered.number} for ${program.name} ` +
        `from ${account.display_name}. It lists ${entered.rows.length} observations.`,
      attachment: { filename, bytes },
    });
  } catch (error) {
    if (error instanceof SmtpRejected) {
      await query(
        `UPDATE packets SET state = 'send_failed', failure = 'mail_rejected',
           revision = revision + 1 WHERE id = $1`,
        [packetId],
      );
      throw new ApiError(502, 'mail_rejected');
    }
    await rollback();
    if (error instanceof SmtpDown) throw new ApiError(503, 'mail_unavailable');
    throw error;
  }

  await query(
    `UPDATE packets SET state = 'sent', sent_at = now(), failure = NULL, revision = revision + 1
     WHERE id = $1`,
    [packetId],
  );
  return toPacket(await readPacketRecord(account.id, packetId));
}

export interface PacketPdfBytes {
  bytes: Uint8Array;
  filename: string;
}

export async function readPacketPdf(
  accountId: string,
  packetId: string,
): Promise<PacketPdfBytes> {
  const record = await readPacketRecord(accountId, packetId);
  if (!record.pdf) throw new ApiError(409, 'no_pdf');
  try {
    const bytes = await getObject(packetPdfKey(accountId, packetId, record.pdf.sha256));
    return { bytes, filename: `lowlamp-packet-${record.number}.pdf` };
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
}

export async function readPacketStrokes(
  accountId: string,
  packetId: string,
  observationId: string,
): Promise<Uint8Array> {
  const record = await readPacketRecord(accountId, packetId);
  const row = record.rows.find((entry) => entry.observation_id === observationId);
  if (!row || !row.strokes_sha256) throw notFound();
  try {
    return await getObject(strokesKey(accountId, observationId, row.strokes_sha256));
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
}
