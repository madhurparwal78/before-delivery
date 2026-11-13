import { randomBytes, randomUUID } from "node:crypto";
import type { Consignor, Portal } from "../../shared/api";
import { brusselsMonth } from "../../shared/brussels";
import type { ConsignorStatus } from "../../shared/catalog";
import { formatDateTime, formatInstant } from "../../shared/format";
import { config } from "../config";
import { pool, transaction, type Db } from "../db";
import { conflict, mailUnavailable, notFound, pageEnded, validationFailed } from "../errors";
import { MailDown, sendMail } from "../mail";
import { loadPieces, pieceView, portalPieceView } from "../pieces";
import { noContent, reply, tokenHash, type Context, type Reply } from "../pipeline";
import { ibanIsValid, storedIban } from "../rules/iban";
import { choiceIsOpen } from "../rules/piece";
import { deleteObject, listKeys, StorageDown } from "../storage";
import { EMAIL_MESSAGE, FieldProblems, IBAN_MESSAGE, isEmail, isRecordList, isText, isUuid, NAME_MESSAGE } from "../validate";
import { payoutView, SELECT_PAYOUTS } from "./payouts";

const ERASED_NAME = "Erased consignor";

interface ConsignorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  status: ConsignorStatus;
  created_at: Date;
}

const consignorView = (row: ConsignorRow): Consignor => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  iban: row.iban,
  ibanValid: row.iban !== null && ibanIsValid(row.iban),
  status: row.status,
  createdAt: formatInstant(row.created_at),
});

async function consignorById(db: Db, id: string): Promise<ConsignorRow> {
  const { rows } = await db.query<ConsignorRow>("SELECT * FROM consignors WHERE id = $1", [id]);
  return rows[0];
}

export async function consignorExists({ params }: Context): Promise<void> {
  if (!isUuid(params.id) || !(await pool.query("SELECT 1 FROM consignors WHERE id = $1", [params.id])).rowCount) throw notFound();
}

export async function listConsignors(): Promise<Reply> {
  const { rows } = await pool.query<ConsignorRow>("SELECT * FROM consignors ORDER BY name, id");
  return reply(200, { consignors: rows.map(consignorView) });
}

export async function getConsignor({ params, now }: Context): Promise<Reply> {
  const row = await consignorById(pool, params.id);
  const pieces = await loadPieces(pool, now, "p.consignor_id = $1 ORDER BY p.tag_number DESC", [params.id]);
  const payouts = await pool.query<Parameters<typeof payoutView>[0]>(`${SELECT_PAYOUTS} WHERE p.consignor_id = $1 ORDER BY p.id DESC`, [params.id]);
  return reply(200, { consignor: consignorView(row), pieces: pieces.map((piece) => pieceView(piece, now)), payouts: payouts.rows.map(payoutView) });
}

const emailTaken = () => conflict("consignor_email_taken", "A consignor already uses this email address.");

export async function createConsignor({ body, now }: Context): Promise<Reply> {
  const { name, email, phone, iban } = body;
  const problems = new FieldProblems();
  if (!isText(name, 120)) problems.add("name", NAME_MESSAGE);
  if (!isEmail(email)) problems.add("email", EMAIL_MESSAGE);
  const stored = typeof iban === "string" && iban.trim() ? storedIban(iban) : null;
  if (iban !== undefined && iban !== null && iban !== "" && !(stored && ibanIsValid(stored))) problems.add("iban", IBAN_MESSAGE);
  problems.check();
  const { rows } = await pool.query<ConsignorRow>(
    `INSERT INTO consignors (id, name, email, phone, iban, status, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)
     ON CONFLICT (lower(email)) DO NOTHING RETURNING *`,
    [randomUUID(), name, email, typeof phone === "string" && phone.trim() ? phone : null, stored, now],
  );
  const row = rows[0];
  if (!row) throw emailTaken();
  return reply(201, { consignor: consignorView(row) });
}

export async function updateConsignor({ params, body }: Context): Promise<Reply> {
  const { name, email, phone, iban } = body;
  const problems = new FieldProblems();
  if (name !== undefined && !isText(name, 120)) problems.add("name", NAME_MESSAGE);
  if (email !== undefined && !isEmail(email)) problems.add("email", EMAIL_MESSAGE);
  const stored = typeof iban === "string" && iban.trim() ? storedIban(iban) : null;
  if (iban !== undefined && iban !== null && iban !== "" && !(stored && ibanIsValid(stored))) problems.add("iban", IBAN_MESSAGE);
  problems.check();
  const row = await consignorById(pool, params.id);
  if (row.status !== "active") throw conflict("consignor_erased", "This consignor was erased.");
  try {
    const { rows } = await pool.query<ConsignorRow>("UPDATE consignors SET name = $2, email = $3, phone = $4, iban = $5 WHERE id = $1 RETURNING *", [
      row.id,
      name === undefined ? row.name : name,
      email === undefined ? row.email : email,
      phone === undefined ? row.phone : typeof phone === "string" && phone.trim() ? phone : null,
      iban === undefined ? row.iban : stored,
    ]);
    return reply(200, { consignor: consignorView(rows[0]) });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") throw emailTaken();
    throw error;
  }
}

export async function sendPageAddress({ params, now }: Context): Promise<Reply> {
  const row = await consignorById(pool, params.id);
  if (row.status !== "active") throw conflict("consignor_erased", "This consignor was erased.");
  if (!row.email) throw validationFailed({ email: EMAIL_MESSAGE });
  const { email } = row;
  const token = randomBytes(32).toString("base64url");
  const whole = new Date(now.getTime() - (now.getTime() % 1000));
  const endsAt = new Date(whole.getTime() + config.portalPageSeconds * 1000);
  await transaction(async (db) => {
    await db.query("SELECT 1 FROM consignors WHERE id = $1 FOR UPDATE", [row.id]);
    await db.query("UPDATE portal_pages SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL", [row.id, now]);
    await db.query("INSERT INTO portal_pages (token_hash, consignor_id, ends_at) VALUES ($1, $2, $3)", [tokenHash(token), row.id, endsAt]);
    try {
      await sendMail({
        to: email,
        subject: "Your Atelier Ourlet consignor page",
        text: [`Your consignor page: ${config.publicUrl}/c/${token}`, `It works until ${formatDateTime(endsAt)}.`].join("\n"),
      });
    } catch (error) {
      if (error instanceof MailDown) throw mailUnavailable("The page address can't be sent by mail right now. The old address still works.");
      throw error;
    }
  });
  return reply(201, { pageEndsAt: formatInstant(endsAt) });
}

export async function endPageAddress({ params, now }: Context): Promise<Reply> {
  await pool.query("UPDATE portal_pages SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL", [params.id, now]);
  return noContent();
}

const ERASING_RETRY_MS = 5000;

/** Asks MinIO what it still holds of a consignor's unsold pieces, deletes it, and shows Erased only once MinIO confirms nothing is left. */
async function finishErasure(consignorId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT p.id FROM pieces p WHERE p.consignor_id = $1 AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.piece_id = p.id AND s.refunded_at IS NULL)`,
    [consignorId],
  );
  await listKeys(`erasure-check/${consignorId}`);
  for (const piece of rows) {
    const prefix = `pieces/${piece.id}/`;
    for (const key of await listKeys(prefix)) await deleteObject(key);
    if ((await listKeys(prefix)).length) throw new StorageDown("objects are still present");
    await pool.query("DELETE FROM photos WHERE piece_id = $1", [piece.id]);
  }
  await pool.query("UPDATE consignors SET status = 'erased' WHERE id = $1", [consignorId]);
}

async function tryFinishErasure(consignorId: string): Promise<void> {
  await finishErasure(consignorId).catch((error: unknown) => {
    if (!(error instanceof StorageDown)) console.error(error);
  });
}

/** While MinIO is unreachable a consignor stays erasing; this retries them every five seconds. */
export function startErasureRetries(): void {
  setInterval(() => {
    void pool
      .query<{ id: string }>("SELECT id FROM consignors WHERE status = 'erasing'")
      .then(async ({ rows }) => {
        for (const { id } of rows) await tryFinishErasure(id);
      })
      .catch((error: unknown) => console.error(error));
  }, ERASING_RETRY_MS);
}

export async function eraseConsignor({ params, now }: Context): Promise<Reply> {
  await transaction(async (db) => {
    await db.query("SELECT 1 FROM consignors WHERE id = $1 FOR UPDATE", [params.id]);
    const row = await consignorById(db, params.id);
    if (row.status !== "active") throw conflict("already_erased", "This consignor was already erased.");
    await db.query("UPDATE request_keys SET response = replace(response, $1, $2)", [JSON.stringify(row.name), JSON.stringify(ERASED_NAME)]);
    if (row.email) {
      await db.query("UPDATE appointments SET name = $2, email = '' WHERE lower(email) = lower($1)", [row.email, ERASED_NAME]);
      await db.query("UPDATE holds SET shopper_name = $2, shopper_email = '' WHERE lower(shopper_email) = lower($1)", [row.email, ERASED_NAME]);
    }
    await db.query("UPDATE consignors SET name = $2, email = NULL, phone = NULL, iban = NULL, status = 'erasing' WHERE id = $1", [row.id, ERASED_NAME]);
    await db.query("UPDATE payouts SET iban = NULL WHERE consignor_id = $1", [row.id]);
    await db.query("UPDATE portal_pages SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL", [row.id, now]);
    const unsold = "p.consignor_id = $1 AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.piece_id = p.id AND s.refunded_at IS NULL)";
    await db.query(`UPDATE holds h SET released_at = $2 FROM pieces p WHERE h.piece_id = p.id AND ${unsold} AND h.released_at IS NULL AND h.ended_at IS NULL AND h.ends_at > $2`, [row.id, now]);
    await db.query(`UPDATE pieces p SET archived_at = $2 WHERE ${unsold} AND p.archived_at IS NULL`, [row.id, now]);
  });
  await tryFinishErasure(params.id);
  return reply(202, { consignor: consignorView(await consignorById(pool, params.id)) });
}

interface PageRow {
  consignor_id: string;
  ends_at: Date;
  ended_at: Date | null;
}

const pagesByToken = (token: string) => pool.query<PageRow>("SELECT consignor_id, ends_at, ended_at FROM portal_pages WHERE token_hash = $1", [tokenHash(token)]);

export async function portalPageIsOpen({ params, now }: Context): Promise<void> {
  const { rows: [page] } = await pagesByToken(params.token);
  if (!page) throw notFound();
  if (page.ended_at || now >= page.ends_at) throw pageEnded();
}

async function portalPieces(consignorId: string, now: Date) {
  return loadPieces(pool, now, "p.consignor_id = $1 AND p.archived_at IS NULL ORDER BY p.tag_number DESC", [consignorId]);
}

export async function portal({ params, now }: Context): Promise<Reply> {
  const { rows: [page] } = await pagesByToken(params.token);
  const consignor = await consignorById(pool, page.consignor_id);
  const pieces = await portalPieces(page.consignor_id, now);
  const earnings = new Map<string, number>();
  const { rows: sales } = await pool.query<{ sold_at: Date; share: number }>(
    `SELECT s.sold_at, s.consignor_share_cents AS share FROM sales s JOIN pieces p ON p.id = s.piece_id
     WHERE p.consignor_id = $1 AND s.refunded_at IS NULL ORDER BY s.sold_at`,
    [page.consignor_id],
  );
  for (const sale of sales) earnings.set(brusselsMonth(sale.sold_at), (earnings.get(brusselsMonth(sale.sold_at)) ?? 0) + sale.share);
  const view: Portal = {
    consignor: { name: consignor.name, ibanLast4: consignor.iban?.slice(-4) ?? null, ibanValid: consignor.iban !== null && ibanIsValid(consignor.iban) },
    pageEndsAt: formatInstant(page.ends_at),
    pieces: pieces.map((piece) => portalPieceView(piece, now)),
    earnings: [...earnings.entries()].map(([month, shareCents]) => ({ month, shareCents })),
  };
  return reply(200, view);
}

export async function portalPiece({ params, now }: Context): Promise<Reply> {
  const { rows: [page] } = await pagesByToken(params.token);
  const piece = (await portalPieces(page.consignor_id, now)).find((candidate) => candidate.id === params.pieceId);
  if (!piece) throw notFound();
  return reply(200, { piece: portalPieceView(piece, now) });
}

export async function saveChoices({ params, body, now }: Context): Promise<Reply> {
  const { rows: [page] } = await pagesByToken(params.token);
  const pieces = await portalPieces(page.consignor_id, now);
  const requested = isRecordList(body.choices) ? body.choices : null;
  if (!requested) throw validationFailed({ choices: "Send a list of choices." });
  for (const { pieceId } of requested) if (!pieces.some((piece) => piece.id === pieceId)) throw notFound();
  const problems = new FieldProblems();
  for (const { choice } of requested) if (choice !== "return" && choice !== "donate") problems.add("choice", "Choose Return to me or Donate.");
  problems.check();
  for (const piece of pieces.filter((candidate) => requested.some(({ pieceId }) => pieceId === candidate.id))) {
    if (piece.liveSale || !choiceIsOpen(piece, now)) throw conflict("choice_closed", `The choice for ${piece.tagCode} is closed.`);
  }
  await transaction(async (db) => {
    for (const { pieceId, choice } of requested) await db.query("UPDATE pieces SET choice = $2 WHERE id = $1", [pieceId, choice]);
  });
  const saved = await portalPieces(page.consignor_id, now);
  return reply(200, { pieces: saved.map((piece) => portalPieceView(piece, now)) });
}
