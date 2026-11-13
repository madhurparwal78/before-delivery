import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { problems, type ProblemCode } from "../shared/completeness";
import { REASON_MESSAGES } from "../shared/messages";
import { coverPage, packetDocument, rowPage, SORA_FILES, type PageObservation } from "../shared/packet-page";
import { isoSeconds, localClock, offsetAt } from "../shared/time";
import type { Packet, PacketReason, PacketRow, PacketState } from "../shared/types";
import { sendMail } from "./mail";
import { isUuid, lockAccount, newId, pool, transaction } from "./db";
import { ApiError, Fields, invalidTransition, MailRejected, MailUnavailable, notFound, RendererUnavailable, StorageUnavailable } from "./errors";
import type { Reply } from "./http";
import { PUBLIC_DIR } from "./http";
import { pdfPageCount, renderPdf } from "./render";
import { deleteObject, digest, getObject, headObject, listKeys, md5, pdfKey, pdfPrefix, putObject, strokeKey } from "./storage";
import {
  OBSERVATION_SELECT,
  loadPrograms,
  packetRow,
  packetView,
  type ObservationRow,
  type PacketRowData,
  judgedOf,
} from "./views";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/* ---------- the one place packets change state because an observation changed ---------- */

/**
 * An applied edit returns every citing packet that has not started sending to draft; a deleted
 * observation also leaves the packets' rows (drafts stay drafts and keep `returned_to_draft`).
 */
export async function returnCitingToDraft(client: PoolClient, accountId: string, observationId: string, remove: boolean): Promise<void> {
  await client.query(
    `UPDATE packets SET
       observation_ids = ${remove ? "array_remove(observation_ids, $2::uuid)" : "observation_ids"},
       returned_to_draft = ${remove ? "CASE WHEN state = 'draft' THEN returned_to_draft ELSE true END" : "true"},
       state = 'draft', pdf = NULL, rows = '[]', failure = NULL, render_attempt = NULL, before_send = NULL,
       state_since = now(), revision = revision + 1
     WHERE account_id = $1 AND observation_ids @> ARRAY[$2]::uuid[]
       AND state NOT IN ('sending', 'sent')${remove ? "" : " AND state <> 'draft'"}`,
    [accountId, observationId],
  );
}

/* ---------- reads ---------- */

async function ownedPacket(client: PoolClient | typeof pool, accountId: string, id: string, lock = false): Promise<PacketRowData> {
  if (!isUuid(id)) throw notFound();
  const row = await packetRow(client, id, accountId, lock);
  if (!row) throw notFound();
  return row;
}

export async function listPackets(accountId: string): Promise<Reply> {
  const { rows } = await pool.query<PacketRowData>("SELECT * FROM packets WHERE account_id = $1 ORDER BY number DESC", [accountId]);
  return { status: 200, body: { packets: rows.map(packetView) } };
}

export async function getPacket(accountId: string, id: string): Promise<Reply> {
  return { status: 200, body: packetView(await ownedPacket(pool, accountId, id)) };
}

export async function downloadPdf(accountId: string, id: string): Promise<Reply> {
  const packet = await ownedPacket(pool, accountId, id);
  if (!packet.pdf) throw new ApiError(409, { error: "no_pdf" });
  const data = await getObject(pdfKey(accountId, packet.id, packet.pdf.sha256));
  if (!data) throw new StorageUnavailable();
  return {
    status: 200,
    raw: { data, type: "application/pdf" },
    headers: { "content-disposition": `attachment; filename="lowlamp-packet-${packet.number}.pdf"` },
  };
}

export async function packetStrokes(accountId: string, id: string, observationId: string): Promise<Reply> {
  const packet = await ownedPacket(pool, accountId, id);
  const row = packet.rows.find((r) => r.observation_id === observationId);
  if (!row || !row.strokes_sha256) throw notFound();
  const data = await getObject(strokeKey(accountId, observationId, row.strokes_sha256));
  if (!data) throw new StorageUnavailable();
  return { status: 200, raw: { data, type: "application/json" } };
}

/* ---------- create and rows ---------- */

/** 404 for any id that isn't the account's own live observation. */
async function assertOwned(client: PoolClient, accountId: string, raw: unknown): Promise<void> {
  if (!Array.isArray(raw)) return;
  const distinct = [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase()))];
  if (distinct.some((v) => !isUuid(v))) throw notFound();
  if (distinct.length === 0) return;
  const { rows } = await client.query<{ id: string }>("SELECT id FROM observations WHERE account_id = $1 AND NOT deleted AND id = ANY($2::uuid[])", [accountId, distinct]);
  if (rows.length !== distinct.length) throw notFound();
}

/** The packet's row list: owned, 1 to 200 ids, no repeats. */
function checkObservationIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const strings = list.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  if (!Array.isArray(raw) || strings.length !== list.length || list.length < 1 || list.length > 200 || new Set(strings).size !== list.length) {
    throw new Fields().add("observation_ids").toError();
  }
  return strings;
}

export async function createPacket(accountId: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  return transaction(async (client) => {
    await lockAccount(client, accountId);
    if (typeof input.program_id === "string" && (await loadPrograms(client, input.program_id)).length === 0) throw notFound();
    await assertOwned(client, accountId, input.observation_ids);
    const ids = checkObservationIds(input.observation_ids);
    if (typeof input.program_id !== "string") throw new Fields().add("program_id").toError();
    const number = (await client.query<{ packet_seq: number }>("UPDATE accounts SET packet_seq = packet_seq + 1 WHERE id = $1 RETURNING packet_seq", [accountId])).rows[0]?.packet_seq;
    const id = newId();
    const { rows } = await client.query<PacketRowData>(
      `INSERT INTO packets (id, account_id, number, program_id, state, revision, observation_ids)
       VALUES ($1,$2,$3,$4,'draft',1,$5) RETURNING *`,
      [id, accountId, number, input.program_id, ids],
    );
    return { status: 201, body: packetView(rows[0] as PacketRowData) };
  });
}

/** The state machine's guard: an illegal action is 409 (even on an old revision), a stale legal one 412. */
function guard(packet: PacketRowData, allowed: readonly PacketState[], body: Record<string, unknown>): void {
  if (!allowed.includes(packet.state)) throw invalidTransition(packet.state);
  if (typeof body.revision !== "number" || !Number.isInteger(body.revision)) throw new Fields().add("revision").toError();
  if (body.revision !== packet.revision) throw new ApiError(412, { error: "stale_revision", packet: packetView(packet) });
}

export async function replaceRows(accountId: string, id: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  return transaction(async (client) => {
    await lockAccount(client, accountId);
    const packet = await ownedPacket(client, accountId, id, true);
    await assertOwned(client, accountId, input.observation_ids);
    guard(packet, ["draft", "checked"], input);
    const ids = checkObservationIds(input.observation_ids);
    const { rows } = await client.query<PacketRowData>(
      `UPDATE packets SET observation_ids = $2, rows = '[]', state = 'draft', returned_to_draft = false, pdf = NULL, failure = NULL,
         state_since = now(), revision = revision + 1 WHERE id = $1 RETURNING *`,
      [packet.id, ids],
    );
    return { status: 200, body: packetView(rows[0] as PacketRowData) };
  });
}

/* ---------- check ---------- */

async function loadRows(client: PoolClient | typeof pool, accountId: string, ids: string[]): Promise<ObservationRow[]> {
  const { rows } = await client.query<ObservationRow>(`${OBSERVATION_SELECT} WHERE o.account_id = $1 AND o.id = ANY($2::uuid[])`, [accountId, ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export async function checkPacket(accountId: string, id: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  return transaction(async (client) => {
    await lockAccount(client, accountId);
    const packet = await ownedPacket(client, accountId, id, true);
    guard(packet, ["draft"], input);
    const program = (await loadPrograms(client, packet.program_id))[0];
    if (!program) throw new Error("packet program missing");
    const observations = await loadRows(client, accountId, packet.observation_ids);
    const reasons: PacketReason[] = [];
    const seen = new Set<string>();
    const passing = new Set<string>();
    const rows: PacketRow[] = [];
    for (const obs of observations) {
      const { edition, codes } = problems(judgedOf(obs), program);
      const all: (ProblemCode | "duplicate_object")[] = [...codes];
      if (seen.has(obs.object_id) && codes[0] !== "not_on_program") all.splice(0, 0, "duplicate_object");
      seen.add(obs.object_id);
      const date = obs.evening_date;
      for (const code of all) {
        const message =
          code === "short_description"
            ? REASON_MESSAGES.short_description(obs.designation, date, edition.min_description)
            : REASON_MESSAGES[code](obs.designation, date);
        reasons.push({ observation_id: obs.id, code, message });
      }
      if (all.length === 0) passing.add(obs.object_id);
      rows.push({ observation_id: obs.id, designation: obs.designation, evening_date: date, edition: edition.edition, strokes_sha256: obs.sketch?.strokes_sha256 ?? null });
    }
    if (passing.size < program.required_count) {
      reasons.push({
        observation_id: null,
        code: "too_few",
        message: `This packet has ${passing.size} qualifying objects; the certificate needs ${program.required_count}.`,
      });
    }
    if (reasons.length > 0) throw new ApiError(422, { error: "incomplete", reasons });
    const { rows: updated } = await client.query<PacketRowData>(
      "UPDATE packets SET state = 'checked', rows = $2, returned_to_draft = false, state_since = now(), revision = revision + 1 WHERE id = $1 RETURNING *",
      [packet.id, JSON.stringify(rows)],
    );
    return { status: 200, body: packetView(updated[0] as PacketRowData) };
  });
}

/* ---------- render ---------- */

export async function startRender(accountId: string, id: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  const attempt = randomUUID();
  const reply = await transaction(async (client) => {
    await lockAccount(client, accountId);
    const packet = await ownedPacket(client, accountId, id, true);
    guard(packet, ["checked", "render_failed"], input);
    const { rows } = await client.query<PacketRowData>(
      "UPDATE packets SET state = 'rendering', render_attempt = $2, failure = NULL, state_since = now(), revision = revision + 1 WHERE id = $1 RETURNING *",
      [packet.id, attempt],
    );
    return { status: 202, body: packetView(rows[0] as PacketRowData) } satisfies Reply;
  });
  setImmediate(() => {
    runRender(accountId, id, attempt).catch((error: unknown) => console.error("render job failed", error instanceof Error ? error.message : error));
  });
  return reply;
}

let fontFiles: { name: string; data: Buffer }[] | null = null;

async function loadFonts(): Promise<{ name: string; data: Buffer }[]> {
  fontFiles ??= await Promise.all(SORA_FILES.map(async (name) => ({ name, data: await readFile(join(PUBLIC_DIR, "fonts", name)) })));
  return fontFiles;
}

async function isNewest(client: PoolClient | typeof pool, packetId: string, attempt: string): Promise<boolean> {
  const { rows } = await client.query("SELECT 1 FROM packets WHERE id = $1 AND state = 'rendering' AND render_attempt = $2", [packetId, attempt]);
  return rows.length > 0;
}

async function pageData(accountId: string, packet: PacketRowData): Promise<{ cover: string; pages: string[] }> {
  const observations = await loadRows(pool, accountId, packet.observation_ids);
  const program = (await loadPrograms(pool, packet.program_id))[0];
  const account = (await pool.query<{ display_name: string; email: string }>("SELECT display_name, email FROM accounts WHERE id = $1", [accountId])).rows[0];
  if (!program || !account) throw new Error("packet context missing");
  const names = async (table: "telescopes" | "eyepieces" | "barlows", ids: string[]) =>
    new Map((await pool.query<{ id: string; name: string }>(`SELECT id, name FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => [r.id, r.name]));
  const telescopes = await names("telescopes", observations.map((o) => o.optics.telescope_id));
  const eyepieces = await names("eyepieces", observations.map((o) => o.optics.eyepiece_id));
  const barlows = await names("barlows", observations.flatMap((o) => (o.optics.barlow_id ? [o.optics.barlow_id] : [])));
  const pages: string[] = [];
  for (const obs of observations) {
    const row = packet.rows.find((r) => r.observation_id === obs.id);
    let strokes = null;
    if (row?.strokes_sha256 && obs.sketch) {
      const data = await getObject(strokeKey(accountId, obs.id, row.strokes_sha256));
      if (!data) throw new StorageUnavailable();
      strokes = JSON.parse(data.toString("utf8")) as PageObservation["strokes"];
    }
    const zone = obs.time_zone;
    const at = obs.observed_at;
    pages.push(
      rowPage({
        designation: obs.designation,
        objectName: obs.object_name,
        kind: obs.kind,
        observedAt: at ? isoSeconds(at) : null,
        localTime: at ? localClock(at, zone) : null,
        localOffset: at ? offsetAt(at, zone) : null,
        timeZone: zone,
        siteName: obs.site_name,
        seeing: obs.seeing,
        transparencyNelm: obs.transparency_nelm,
        telescopeName: telescopes.get(obs.optics.telescope_id) ?? "",
        eyepieceName: eyepieces.get(obs.optics.eyepiece_id) ?? "",
        barlowName: obs.optics.barlow_id ? (barlows.get(obs.optics.barlow_id) ?? null) : null,
        derived: obs.derived,
        edition: row?.edition ?? 1,
        concentrationClass: obs.concentration_class,
        pair: obs.pair,
        description: obs.description,
        strokes,
      }),
    );
  }
  const cover = coverPage({
    number: packet.number,
    programName: program.name,
    observerName: account.display_name,
    observerEmail: account.email,
    rowCount: observations.length,
    coordinatorName: program.coordinator_name,
  });
  return { cover, pages };
}

async function finishRender(accountId: string, packetId: string, attempt: string, outcome: { pdf: NonNullable<Packet["pdf"]> } | { failure: "renderer_unavailable" | "storage_unavailable" }): Promise<void> {
  const purge: string[] = [];
  await transaction(async (client) => {
    await lockAccount(client, accountId);
    if (!(await isNewest(client, packetId, attempt))) return;
    if ("pdf" in outcome) {
      await client.query("UPDATE packets SET state = 'rendered', pdf = $2, failure = NULL, state_since = now(), revision = revision + 1 WHERE id = $1", [packetId, JSON.stringify(outcome.pdf)]);
    } else {
      await client.query("UPDATE packets SET state = 'render_failed', pdf = NULL, failure = $2, render_attempt = NULL, state_since = now(), revision = revision + 1 WHERE id = $1", [packetId, outcome.failure]);
    }
    purge.push(pdfPrefix(accountId, packetId));
  });
  if (purge.length === 0) return;
  const keep = "pdf" in outcome ? pdfKey(accountId, packetId, outcome.pdf.sha256) : null;
  try {
    for (const key of await listKeys(purge[0] as string)) if (key !== keep) await deleteObject(key);
  } catch {
    // Storage is down: nothing else was written by a failed attempt, and a later render purges the prefix.
  }
}

/** One render attempt. Only the newest attempt of a still-rendering packet can change anything. */
async function runRender(accountId: string, packetId: string, attempt: string): Promise<void> {
  const packet = await packetRow(pool, packetId, accountId);
  if (!packet || !(await isNewest(pool, packetId, attempt))) return;
  try {
    const { cover, pages } = await pageData(accountId, packet);
    const fonts = await loadFonts();
    const pdf = await renderPdf(packetDocument([cover, ...pages], ""), fonts);
    if (!(await isNewest(pool, packetId, attempt))) return;
    const sha = digest(pdf);
    const key = pdfKey(accountId, packetId, sha);
    await putObject(key, pdf, "application/pdf");
    const head = await headObject(key);
    if (!head || head.size !== pdf.length || head.etag !== md5(pdf)) throw new StorageUnavailable();
    await finishRender(accountId, packetId, attempt, { pdf: { size: pdf.length, sha256: sha, pages: pdfPageCount(pdf) } });
    const current = await packetRow(pool, packetId, accountId);
    if (current?.pdf?.sha256 !== sha) await deleteObject(key).catch(() => undefined);
  } catch (error) {
    const failure = error instanceof StorageUnavailable ? "storage_unavailable" : "renderer_unavailable";
    if (!(error instanceof StorageUnavailable) && !(error instanceof RendererUnavailable)) {
      console.error("render failed", error instanceof Error ? error.message : error);
    }
    await finishRender(accountId, packetId, attempt, { failure });
  }
}

/* ---------- send ---------- */

export async function sendPacket(accountId: string, id: string, raw: unknown): Promise<Reply> {
  const input = asRecord(raw);
  const packet = await transaction(async (client) => {
    await lockAccount(client, accountId);
    const current = await ownedPacket(client, accountId, id, true);
    guard(current, ["rendered", "send_failed"], input);
    const before = { state: current.state, revision: current.revision, failure: current.failure };
    const { rows } = await client.query<PacketRowData>(
      "UPDATE packets SET state = 'sending', before_send = $2, state_since = now(), revision = revision + 1 WHERE id = $1 RETURNING *",
      [current.id, JSON.stringify(before)],
    );
    return rows[0] as PacketRowData;
  });
  const restore = async (error: string): Promise<never> => {
    await pool.query(
      `UPDATE packets SET state = before_send->>'state', revision = (before_send->>'revision')::int, failure = before_send->>'failure',
         before_send = NULL, state_since = now() WHERE id = $1 AND state = 'sending'`,
      [packet.id],
    );
    throw new ApiError(503, { error });
  };
  const settle = async (state: "sent" | "send_failed"): Promise<PacketRowData> => {
    const { rows } = await pool.query<PacketRowData>(
      `UPDATE packets SET state = $2, failure = $3, sent_at = ${state === "sent" ? "now()" : "NULL"}, before_send = NULL,
         state_since = now(), revision = revision + 1 WHERE id = $1 RETURNING *`,
      [packet.id, state, state === "sent" ? null : "mail_rejected"],
    );
    return rows[0] as PacketRowData;
  };
  let pdf: Buffer | null;
  try {
    if (!packet.pdf) throw new StorageUnavailable();
    pdf = await getObject(pdfKey(accountId, packet.id, packet.pdf.sha256));
    if (!pdf) throw new StorageUnavailable();
  } catch {
    return restore("storage_unavailable");
  }
  const program = (await loadPrograms(pool, packet.program_id))[0];
  const account = (await pool.query<{ display_name: string; email: string }>("SELECT display_name, email FROM accounts WHERE id = $1", [accountId])).rows[0];
  if (!program || !account) throw new Error("packet context missing");
  try {
    await sendMail({
      to: { name: program.coordinator_name, address: program.coordinator_email },
      cc: account.email,
      subject: `Observing log packet ${packet.number}: ${program.name} — ${account.display_name}`,
      text: `Please find attached observing log packet ${packet.number} for ${program.name} from ${account.display_name}. It lists ${packet.observation_ids.length} observations.`,
      attachment: { filename: `lowlamp-packet-${packet.number}.pdf`, type: "application/pdf", content: pdf },
    });
  } catch (error) {
    if (error instanceof MailRejected) {
      await settle("send_failed");
      throw new ApiError(502, { error: "mail_rejected" });
    }
    if (!(error instanceof MailUnavailable)) console.error("mail failed", error instanceof Error ? error.message : error);
    return restore("mail_unavailable");
  }
  return { status: 200, body: packetView(await settle("sent")) };
}

/* ---------- housekeeping ---------- */

/** Moves packets whose render or send was lost (for example with a stopped instance) out of limbo. */
export async function sweepPackets(): Promise<void> {
  await pool.query(
    `UPDATE packets SET state = 'render_failed', failure = 'renderer_unavailable', render_attempt = NULL, state_since = now(), revision = revision + 1
     WHERE state = 'rendering' AND state_since < now() - interval '70 seconds'`,
  );
  await pool.query(
    `UPDATE packets SET state = before_send->>'state', revision = (before_send->>'revision')::int, failure = before_send->>'failure',
       before_send = NULL, state_since = now()
     WHERE state = 'sending' AND before_send IS NOT NULL AND state_since < now() - interval '70 seconds'`,
  );
}
