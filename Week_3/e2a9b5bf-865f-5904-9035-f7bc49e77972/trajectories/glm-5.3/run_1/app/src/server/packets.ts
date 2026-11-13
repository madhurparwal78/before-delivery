// Packets: creation, rows, check, render, send and the state machine
// (DP-32, DP-33, DP-34, DP-37, DP-41, DP-43, DP-73, DP-74).
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { Packet, PacketRow } from "#shared/api.js";
import { packetStateLabels } from "#shared/sentences.js";
import { editionForDate } from "#shared/completeness.js";
import { ApiError, errors } from "./errors.js";
import { packetLockKey, withTransaction } from "./db.js";
import { PACKET_SELECT, packetFromRow, type PacketRowRecord } from "./rows.js";
import type { StorageClient } from "./services/storage.js";
import type { RendererClient } from "./services/renderer.js";
import type { MailClient } from "./services/mail.js";
import { buildPacketHtml, countPdfPages, type PacketPageData } from "./pdf.js";
import { canonicalUtc } from "#shared/time.js";
import { representativeQualifyingObservation, loadProgramById, type ProgramRecord } from "./programs.js";

export function mapPacket(row: PacketRowRecord): Packet {
  return packetFromRow(row, packetStateLabels[row.state as Packet["state"]]);
}

export async function loadPacket(pool: Pool, accountId: string, packetId: string): Promise<PacketRowRecord | null> {
  const result = await pool.query<PacketRowRecord>(
    `${PACKET_SELECT} WHERE id = $1 AND account_id = $2`,
    [packetId, accountId],
  );
  return result.rows[0] ?? null;
}

export interface PacketRowRecordResult {
  readonly record: PacketRowRecord;
}

// One place for the packet state transitions (Business rules).
export function transitionAllows(state: string, action: "rows" | "check" | "render" | "send"): boolean {
  switch (action) {
    case "rows":
      return state === "draft" || state === "checked";
    case "check":
      return state === "draft";
    case "render":
      return state === "checked" || state === "render_failed";
    case "send":
      return state === "rendered" || state === "send_failed";
    default:
      return false;
  }
}

export function assertRevision(record: PacketRowRecord, revision: number | undefined): void {
  if (revision === undefined || !Number.isInteger(revision)) {
    throw errors.validation({ revision: "Send the revision you are acting on." });
  }
  if (revision !== record.revision) {
    throw errors.staleRevision(mapPacket(record));
  }
}

export async function createPacket(
  pool: Pool,
  accountId: string,
  programId: string,
  observationIds: readonly string[],
): Promise<PacketRowRecord> {
  if (observationIds.length === 0 || observationIds.length > 200) {
    throw errors.validation({ observation_ids: "A packet holds from 1 to 200 observations." });
  }
  if (new Set(observationIds).size !== observationIds.length) {
    throw errors.validation({ observation_ids: "A packet cites each observation once." });
  }
  return withTransaction(pool, async (client) => {
    const program = await loadProgramById(client, programId);
    if (!program) throw errors.notFound();
    for (const observationId of observationIds) {
      const row = await client.query<{ account_id: string; deleted: boolean }>(
        "SELECT account_id, deleted FROM observations WHERE id = $1",
        [observationId],
      );
      const record = row.rows[0];
      if (!record || record.account_id !== accountId || record.deleted) throw errors.notFound();
    }
    const numberRow = await client.query<{ next: number }>(
      "SELECT coalesce(max(number), 0) + 1 AS next FROM packets WHERE account_id = $1",
      [accountId],
    );
    const number = numberRow.rows[0]?.next ?? 1;
    const now = new Date();
    const id = randomUUID();
    await client.query(
      `INSERT INTO packets (id, account_id, program_id, number, state, revision, observation_ids, rows, returned_to_draft, created_at, created_at_text)
       VALUES ($1,$2,$3,$4,'draft',1,$5,'[]'::jsonb,false,$6,$7)`,
      [id, accountId, programId, number, JSON.stringify(observationIds), now, canonicalUtc(now.getTime())],
    );
    const record = await loadPacketRow(client, accountId, id);
    if (!record) throw errors.internal();
    return record;
  });
}

export async function loadPacketRow(client: PoolClient, accountId: string, packetId: string): Promise<PacketRowRecord | null> {
  const result = await client.query<PacketRowRecord>(`${PACKET_SELECT} WHERE id = $1 AND account_id = $2`, [packetId, accountId]);
  return result.rows[0] ?? null;
}

export async function replaceRows(
  pool: Pool,
  accountId: string,
  packetId: string,
  revision: number | undefined,
  observationIds: readonly string[],
): Promise<PacketRowRecord> {
  if (observationIds.length === 0 || observationIds.length > 200) {
    throw errors.validation({ observation_ids: "A packet holds from 1 to 200 observations." });
  }
  if (new Set(observationIds).size !== observationIds.length) {
    throw errors.validation({ observation_ids: "A packet cites each observation once." });
  }
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const record = await loadPacketRow(client, accountId, packetId);
    if (!record) throw errors.notFound();
    assertRevision(record, revision);
    if (!transitionAllows(record.state, "rows")) {
      throw errors.invalidTransition(record.state);
    }
    for (const observationId of observationIds) {
      const row = await client.query<{ account_id: string; deleted: boolean }>(
        "SELECT account_id, deleted FROM observations WHERE id = $1",
        [observationId],
      );
      const found = row.rows[0];
      if (!found || found.account_id !== accountId || found.deleted) throw errors.notFound();
    }
    await client.query(
      `UPDATE packets SET observation_ids = $1, revision = revision + 1, state = 'draft', rows = '[]'::jsonb,
         pdf = NULL, returned_to_draft = false WHERE id = $2`,
      [JSON.stringify(observationIds), packetId],
    );
    const updated = await loadPacketRow(client, accountId, packetId);
    if (!updated) throw errors.internal();
    return updated;
  });
}

export interface CheckOutcome {
  readonly record?: PacketRowRecord;
  readonly reasons?: readonly unknown[];
}

export async function checkPacket(
  pool: Pool,
  accountId: string,
  packetId: string,
  revision: number | undefined,
): Promise<CheckOutcome> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const record = await loadPacketRow(client, accountId, packetId);
    if (!record) throw errors.notFound();
    assertRevision(record, revision);
    if (!transitionAllows(record.state, "check")) throw errors.invalidTransition(record.state);
    const program = await loadProgramById(client, record.program_id);
    if (!program) throw errors.notFound();
    const reasons: unknown[] = [];
    const seenObjects = new Set<string>();
    const rows: PacketRow[] = [];
    const loaded: { row: { observation_id: string; designation: string; evening_date: string; edition: number; strokes_sha256: string | null }; passes: boolean }[] = [];
    for (const observationId of record.observation_ids) {
      const observation = await loadObservationForCheck(client, accountId, observationId);
      if (!observation) throw errors.notFound();
      const onProgram = program.objectIds.includes(observation.object_id);
      if (!onProgram) {
        reasons.push({ observation_id: observationId, code: "not_on_program", message: `${observation.designation}, ${observation.eveningDate}: not on this program's list.` });
        continue;
      }
      if (seenObjects.has(observation.object_id)) {
        reasons.push({ observation_id: observationId, code: "duplicate_object", message: `${observation.designation}, ${observation.eveningDate}: only one observation per object.` });
        continue;
      }
      seenObjects.add(observation.object_id);
      const rowReasons = observation.reasons(program.editions);
      if (rowReasons.length > 0) {
        reasons.push(...rowReasons);
        continue;
      }
      const edition = editionForDate(program.editions, observation.eveningDate);
      rows.push({
        observation_id: observationId,
        designation: observation.designation,
        evening_date: observation.eveningDate,
        edition: edition.edition,
        strokes_sha256: observation.strokesSha256,
      });
    }
    if (rows.length < program.requiredCount) {
      reasons.push({
        observation_id: null,
        code: "too_few",
        message: `This packet has ${rows.length} qualifying objects; the certificate needs ${program.requiredCount}.`,
      });
    }
    if (reasons.length > 0) {
      return { reasons };
    }
    await client.query(
      `UPDATE packets SET state = 'checked', revision = revision + 1, rows = $1, returned_to_draft = false WHERE id = $2`,
      [JSON.stringify(rows), packetId],
    );
    const updated = await loadPacketRow(client, accountId, packetId);
    if (!updated) throw errors.internal();
    return { record: updated };
  });
}

interface CheckObservation {
  readonly object_id: string;
  readonly designation: string;
  readonly eveningDate: string;
  readonly strokesSha256: string | null;
  readonly hasSketch: boolean;
  reasons(editions: readonly unknown[]): readonly unknown[];
}

async function loadObservationForCheck(
  client: PoolClient,
  accountId: string,
  observationId: string,
): Promise<CheckObservation | null> {
  const result = await client.query<{
    object_id: string; designation: string; evening_date: string; strokes_sha256: string | null;
    observed_at_text: string | null; seeing: number | null; transparency_nelm: string | null;
    concentration_class: string | null; description: string; kind: string;
    pair_primary: unknown; pair_secondary: unknown;
  }>(
    `SELECT o.object_id, ob.designation, o.evening_date, o.strokes_sha256, o.observed_at_text, o.seeing,
            o.transparency_nelm, o.concentration_class, o.description, ob.kind, o.pair_primary, o.pair_secondary
     FROM observations o JOIN objects ob ON ob.id = o.object_id
     WHERE o.id = $1 AND o.account_id = $2 AND o.deleted = false`,
    [observationId, accountId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    object_id: row.object_id,
    designation: row.designation,
    eveningDate: row.evening_date,
    strokesSha256: row.strokes_sha256,
    hasSketch: row.strokes_sha256 !== null,
    reasons(editions) {
      const edition = editionForDate(editions as never, row.evening_date);
      const problems: unknown[] = [];
      const label = `${row.designation}, ${row.evening_date}`;
      if (!row.observed_at_text) problems.push({ observation_id: null, code: "missing_ut_time", message: `${label}: add the UT time.` });
      if (row.seeing === null) problems.push({ observation_id: null, code: "missing_seeing", message: `${label}: add seeing from 1 to 10.` });
      if (row.transparency_nelm === null) problems.push({ observation_id: null, code: "missing_transparency", message: `${label}: add transparency as a limiting magnitude.` });
      if ((edition as unknown as { concentration_required: boolean }).concentration_required && row.concentration_class === null) {
        problems.push({ observation_id: null, code: "missing_concentration", message: `${label}: add the Shapley-Sawyer concentration class.` });
      }
      if ((edition as unknown as { pair_required: boolean }).pair_required && row.kind === "double_star" && (row.pair_primary === null || row.pair_secondary === null)) {
        problems.push({ observation_id: null, code: "missing_pair", message: `${label}: add the measured pair for this double star.` });
      }
      if (row.description.trim().length < (edition as unknown as { min_description: number }).min_description) {
        problems.push({ observation_id: null, code: "short_description", message: `${label}: the description needs at least ${(edition as unknown as { min_description: number }).min_description} characters.` });
      }
      if ((edition as unknown as { sketch_required: boolean }).sketch_required && row.strokes_sha256 === null) {
        problems.push({ observation_id: null, code: "missing_sketch", message: `${label}: this program needs a sketch.` });
      }
      return problems;
    },
  };
}

export async function packetReturnToDraftForObservation(client: PoolClient, accountId: string, observationId: string): Promise<void> {
  const citing = await client.query<{ id: string; state: string }>(
    `SELECT id, state FROM packets
     WHERE account_id = $1 AND observation_ids @> $2::jsonb AND state IN ('checked','rendering','rendered','render_failed','send_failed')`,
    [accountId, JSON.stringify([observationId])],
  );
  for (const packet of citing.rows) {
    await client.query(
      `UPDATE packets SET state = 'draft', revision = revision + 1, rows = '[]'::jsonb, pdf = NULL,
         returned_to_draft = true WHERE id = $1`,
      [packet.id],
    );
  }
}

export async function startRender(
  pool: Pool,
  accountId: string,
  packetId: string,
  revision: number | undefined,
): Promise<PacketRowRecord> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const record = await loadPacketRow(client, accountId, packetId);
    if (!record) throw errors.notFound();
    assertRevision(record, revision);
    if (!transitionAllows(record.state, "render")) throw errors.invalidTransition(record.state);
    await client.query("UPDATE packets SET state = 'rendering', revision = revision + 1 WHERE id = $1", [packetId]);
    const attempt = randomUUID();
    await client.query("INSERT INTO packet_render_attempts (id, packet_id, attempt, state) VALUES ($1,$2,1,'rendering')", [attempt, packetId]);
    const updated = await loadPacketRow(client, accountId, packetId);
    if (!updated) throw errors.internal();
    return updated;
  });
}

export async function finishRender(
  pool: Pool,
  storage: StorageClient,
  renderer: RendererClient,
  accountId: string,
  packetId: string,
): Promise<void> {
  // Runs outside the request's transaction: the attempt's result applies
  // only while it is the newest attempt (DP-74).
  const record = await loadPacket(pool, accountId, packetId);
  if (!record || record.state !== "rendering") return;
  const program = await loadProgramByIdRow(pool, record.program_id);
  const pages = await collectPageData(pool, storage, accountId, record, program);
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderer.renderPdf(buildPacketHtml(record, pages));
  } catch (renderError) {
    console.error("render failed", renderError);
    await markRenderFailure(pool, accountId, packetId, "renderer_unavailable");
    return;
  }
  const sha = sha256HexOf(pdfBytes);
  const key = `observers/${accountId}/packets/${packetId}/${sha}.pdf`;
  try {
    await storage.put(key, pdfBytes, "application/pdf");
    const head = await storage.head(key);
    if (head.size !== pdfBytes.length) throw new Error("size mismatch");
    const stored = await storage.get(key);
    if (sha256HexOf(stored) !== sha) throw new Error("checksum mismatch");
  } catch (storeError) {
    console.error("render store failed", storeError);
    await markRenderFailure(pool, accountId, packetId, "storage_unavailable");
    return;
  }
  await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const current = await loadPacketRow(client, accountId, packetId);
    if (!current || current.state !== "rendering") return;
    await client.query(
      `UPDATE packets SET state = 'rendered', pdf = $1, failure = NULL WHERE id = $2`,
      [JSON.stringify({ size: pdfBytes.length, sha256: sha, pages: countPdfPages(pdfBytes) }), packetId],
    );
    // Only the newest attempt leaves exactly one stored PDF.
    try {
      const keys = await storage.list(`observers/${accountId}/packets/${packetId}/`);
      const others = keys.filter((candidate) => candidate !== key);
      if (others.length > 0) await storage.remove(others);
    } catch {
      // A cleanup failure leaves the packet rendered; the next render cleans up.
    }
  });
}

async function markRenderFailure(pool: Pool, accountId: string, packetId: string, failure: "renderer_unavailable" | "storage_unavailable"): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const current = await loadPacketRow(client, accountId, packetId);
    if (!current || current.state !== "rendering") return;
    await client.query("UPDATE packets SET state = 'render_failed', failure = $1 WHERE id = $2", [failure, packetId]);
  });
}

export async function sendPacket(
  pool: Pool,
  storage: StorageClient,
  mail: MailClient,
  config: { mailFrom: string },
  accountId: string,
  packetId: string,
  revision: number | undefined,
  account: { email: string; display_name: string },
): Promise<{ outcome: "sent" | "mail_unavailable" | "storage_unavailable" | "mail_rejected"; record: PacketRowRecord }> {
  const started = await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const record = await loadPacketRow(client, accountId, packetId);
    if (!record) throw errors.notFound();
    assertRevision(record, revision);
    if (!transitionAllows(record.state, "send")) throw errors.invalidTransition(record.state);
    await client.query("UPDATE packets SET state = 'sending' WHERE id = $1", [packetId]);
    const updated = await loadPacketRow(client, accountId, packetId);
    if (!updated) throw errors.internal();
    return { previousState: record.state, previousRevision: record.revision, record: updated };
  });

  // Sending reads storage first (DP-76).
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await storage.get(`observers/${accountId}/packets/${packetId}/${started.record.pdf?.sha256}.pdf`);
  } catch {
    await rollbackSend(pool, accountId, packetId, started.previousState, started.previousRevision);
    return { outcome: "storage_unavailable", record: (await loadPacket(pool, accountId, packetId))! };
  }
  const program = await loadProgramByIdRow(pool, started.record.program_id);
  try {
    await mail.send({
      from: config.mailFrom,
      toName: program.coordinator_name,
      toAddress: program.coordinator_email,
      cc: account.email,
      subject: `Observing log packet ${started.record.number}: ${program.name} — ${account.display_name}`,
      text: `Please find attached observing log packet ${started.record.number} for ${program.name} from ${account.display_name}. It lists ${started.record.rows.length} observations.`,
      attachmentFilename: `lowlamp-packet-${started.record.number}.pdf`,
      attachment: pdfBytes,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "mail_unavailable") {
      await rollbackSend(pool, accountId, packetId, started.previousState, started.previousRevision);
      return { outcome: "mail_unavailable", record: (await loadPacket(pool, accountId, packetId))! };
    }
    await withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
      const current = await loadPacketRow(client, accountId, packetId);
      if (!current || current.state !== "sending") return;
      await client.query("UPDATE packets SET state = 'send_failed', failure = 'mail_rejected' WHERE id = $1", [packetId]);
    });
    const updated = await loadPacket(pool, accountId, packetId);
    return { outcome: "mail_rejected", record: updated! };
  }
  const now = new Date();
  await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const current = await loadPacketRow(client, accountId, packetId);
    if (!current || current.state !== "sending") return;
    await client.query("UPDATE packets SET state = 'sent', sent_at = $1, sent_at_text = $2, failure = NULL WHERE id = $3", [now, canonicalUtc(now.getTime()), packetId]);
  });
  const final = await loadPacket(pool, accountId, packetId);
  if (!final) throw errors.internal();
  return { outcome: "sent", record: final };
}

async function rollbackSend(pool: Pool, accountId: string, packetId: string, previousState: string, previousRevision: number): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [packetLockNumber(packetId)]);
    const current = await loadPacketRow(client, accountId, packetId);
    if (!current || current.state !== "sending") return;
    await client.query(
      "UPDATE packets SET state = $1, revision = $2, failure = NULL WHERE id = $3",
      [previousState, previousRevision, packetId],
    );
  });
}

export function packetLockNumber(id: string): string {
  const bytes = Buffer.from(id.replace(/-/g, "").padEnd(32, "0").slice(0, 32), "hex");
  return bytes.readBigInt64BE(8).toString();
}

function sha256HexOf(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

import { sha256Hex } from "./services/storage.js";

async function loadProgramByIdRow(pool: Pool, programId: string): Promise<ProgramRecord> {
  const result = await pool.query(`
    SELECT p.id, p.name, p.required_count, p.coordinator_name, p.coordinator_email,
           (SELECT jsonb_agg(jsonb_build_object('edition', e.edition, 'effective_from', e.effective_from,
              'min_description', e.min_description, 'sketch_required', e.sketch_required,
              'concentration_required', e.concentration_required, 'pair_required', e.pair_required) ORDER BY e.edition)
              FROM program_editions e WHERE e.program_id = p.id) AS editions,
           (SELECT jsonb_agg(object_id ORDER BY position) FROM program_objects po WHERE po.program_id = p.id) AS object_ids
    FROM programs p WHERE p.id = $1`, [programId]);
  const row = result.rows[0];
  if (!row) throw errors.notFound();
  return {
    id: row.id,
    name: row.name,
    requiredCount: row.required_count,
    coordinator_name: row.coordinator_name,
    coordinator_email: row.coordinator_email,
    editions: row.editions ?? [],
    objectIds: row.object_ids ?? [],
  };
}

async function collectPageData(pool: Pool, storage: StorageClient, accountId: string, record: PacketRowRecord, program: ProgramRecord): Promise<PacketPageData[]> {
  const pages: PacketPageData[] = [];
  for (const row of record.rows) {
    const observation = await pool.query(`
      SELECT o.id, o.observed_at_text, o.local_time, o.local_offset, o.description, o.seeing, o.transparency_nelm,
             o.concentration_class, o.pair_separation, o.pair_pa, o.pair_primary, o.pair_secondary,
             o.strokes_sha256, o.derived, o.telescope_id, o.eyepiece_id, o.barlow_id, o.train,
             ob.designation, ob.name AS object_name, ob.kind, si.name AS site_name, si.time_zone
      FROM observations o JOIN objects ob ON ob.id = o.object_id
      JOIN observing_sessions s ON s.id = o.session_id JOIN sites si ON si.id = s.site_id
      WHERE o.id = $1 AND o.account_id = $2`, [row.observation_id, accountId]);
    const observationRow = observation.rows[0];
    if (!observationRow) continue;
    const telescope = await pool.query("SELECT name, aperture_mm FROM telescopes WHERE id = $1", [observationRow.telescope_id]);
    const eyepiece = await pool.query("SELECT name FROM eyepieces WHERE id = $1", [observationRow.eyepiece_id]);
    const barlow = observationRow.barlow_id ? await pool.query("SELECT name FROM barlows WHERE id = $1", [observationRow.barlow_id]) : { rows: [] as { name: string }[] };
    let strokesText: string | null = null;
    if (row.strokes_sha256) {
      try {
        const bytes = await storage.get(`observers/${accountId}/strokes/${row.observation_id}/${row.strokes_sha256}.json`);
        strokesText = Buffer.from(bytes).toString("utf8");
      } catch {
        strokesText = null;
      }
    }
    pages.push({
      row,
      observation: observationRow,
      telescopeName: telescope.rows[0]?.name ?? "",
      apertureMm: telescope.rows[0]?.aperture_mm ?? 0,
      eyepieceName: eyepiece.rows[0]?.name ?? "",
      barlowName: barlow.rows[0]?.name ?? null,
      strokesText,
    });
  }
  return pages;
}

export { representativeQualifyingObservation };
