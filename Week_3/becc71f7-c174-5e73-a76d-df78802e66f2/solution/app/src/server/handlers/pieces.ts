import { randomUUID } from "node:crypto";
import { addDays, brusselsDate, brusselsInstant } from "../../shared/brussels";
import { CATEGORIES, CONDITIONS, PIECE_STATUSES, SIZES } from "../../shared/catalog";
import { pool, transaction, type Db } from "../db";
import { conflict, notFound, staleEdit, storageUnavailable, validationFailed } from "../errors";
import { NotAPhoto, photoTypeOf, publicCopyOf } from "../images";
import { loadPiece, loadPieces, pieceRowExists, pieceView } from "../pieces";
import { file, reply, type Context, type Reply } from "../pipeline";
import { parseTagCode } from "../rules/tagCode";
import { deleteObject, getObject, putObject, StorageDown } from "../storage";
import { FieldProblems, INTAKE_MESSAGE, isDate, isPriceCents, isText, isUuid, PRICE_MESSAGE } from "../validate";
import { shownToPublic } from "./rail";

const INTAKE_DAYS_BACK = 730;
const MAX_PHOTOS = 6;
const PHOTO_MESSAGE = "Use a JPEG, PNG or WebP photo.";
const STORAGE_DOWN_COPY = "Photos can't be saved right now. Nothing was stored — try again in a moment.";

export const intakeDateIsAllowed = (date: string, now: Date): boolean => {
  const today = brusselsDate(now);
  return date <= today && date >= addDays(today, -INTAKE_DAYS_BACK);
};

export async function pieceExists({ params }: Context): Promise<void> {
  if (!(await pieceRowExists(pool, params.id))) throw notFound();
}

export async function listPieces({ query, now }: Context): Promise<Reply> {
  const status = query.get("status") ?? "";
  const q = (query.get("q") ?? "").toLowerCase();
  if (status && !PIECE_STATUSES.some((option) => option.value === status)) throw validationFailed({ status: "Choose a published piece status." });
  const pieces = (await loadPieces(pool, now))
    .filter((piece) => !status || piece.status === status)
    .filter((piece) => !q || piece.description.toLowerCase().includes(q) || piece.brand.toLowerCase().includes(q) || piece.tagCode.toLowerCase().includes(q))
    .sort((a, b) => b.tagNumber - a.tagNumber);
  return reply(200, { pieces: pieces.map((piece) => pieceView(piece, now)) });
}

export async function lookupPiece({ query, now }: Context): Promise<Reply> {
  const number = parseTagCode(query.get("tag") ?? "");
  if (number === null) throw validationFailed({ tag: "This tag code's check digit doesn't match." });
  const [piece] = await loadPieces(pool, now, "p.tag_number = $1", [number]);
  if (!piece) throw notFound();
  return reply(200, { piece: pieceView(piece, now) });
}

export async function getPiece({ params, now }: Context): Promise<Reply> {
  return reply(200, { piece: pieceView(await loadPiece(pool, now, params.id), now) });
}

/** The ladder in force on a date: the one with the latest effective date on or before it. */
async function ladderIdOn(db: Db, date: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM ladders WHERE effective_on <= $1 ORDER BY effective_on DESC LIMIT 1", [date]);
  return rows[0].id;
}

export async function insertPiece(db: Db, piece: { consignorId: string; category: string; brand: string; description: string; size: string; condition: string; askingPriceCents: number; intakeDate: string }): Promise<string> {
  const id = randomUUID();
  const { rows } = await db.query<{ last_number: number }>("UPDATE tag_counter SET last_number = last_number + 1 RETURNING last_number");
  await db.query(
    `INSERT INTO pieces (id, tag_number, consignor_id, category, brand, description, size, condition, intake_date, ladder_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, rows[0].last_number, piece.consignorId, piece.category, piece.brand, piece.description, piece.size, piece.condition, piece.intakeDate, await ladderIdOn(db, piece.intakeDate)],
  );
  await db.query("INSERT INTO asking_prices (piece_id, cents, from_at) VALUES ($1, $2, $3)", [id, piece.askingPriceCents, brusselsInstant(piece.intakeDate)]);
  return id;
}

export async function createPiece({ body, now }: Context): Promise<Reply> {
  const { consignorId, category, brand, description, size, condition, askingPriceCents, intakeDate } = body;
  const problems = new FieldProblems();
  if (consignorId === undefined || consignorId === null || consignorId === "") problems.add("consignorId", "Choose a consignor.");
  else {
    const { rowCount } = isUuid(consignorId) ? await pool.query("SELECT 1 FROM consignors WHERE id = $1 AND status = 'active'", [consignorId]) : { rowCount: 0 };
    if (!rowCount) throw notFound();
  }
  if (!CATEGORIES.some((option) => option.value === category)) problems.add("category", "Choose a category.");
  if (!isText(brand, 60)) problems.add("brand", "Enter a brand of 1 to 60 characters.");
  if (!isText(description, 120)) problems.add("description", "Enter a description of 1 to 120 characters.");
  if (!SIZES.some((option) => option.value === size)) problems.add("size", "Choose a size.");
  if (!CONDITIONS.some((option) => option.value === condition)) problems.add("condition", "Choose a condition.");
  if (!isPriceCents(askingPriceCents)) problems.add("askingPriceCents", PRICE_MESSAGE);
  if (!isDate(intakeDate) || !intakeDateIsAllowed(intakeDate, now)) problems.add("intakeDate", INTAKE_MESSAGE);
  problems.check();
  const id = await transaction((db) =>
    insertPiece(db, {
      consignorId: String(consignorId),
      category: String(category),
      brand: String(brand),
      description: String(description),
      size: String(size),
      condition: String(condition),
      askingPriceCents: Number(askingPriceCents),
      intakeDate: String(intakeDate),
    }),
  );
  return reply(201, { piece: pieceView(await loadPiece(pool, now, id), now) });
}

export async function changePrice({ params, body, headers, now }: Context): Promise<Reply> {
  const { askingPriceCents } = body;
  if (!isPriceCents(askingPriceCents)) throw validationFailed({ askingPriceCents: PRICE_MESSAGE });
  return transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (piece.status === "sold" || piece.status === "archived") throw conflict("not_for_sale", "This piece is sold or archived, so its price can't change.");
    const expected = headers["if-match"]?.replace(/^(W\/)?"|"$/g, "");
    if (expected !== undefined && expected !== String(piece.version)) throw staleEdit();
    await db.query("INSERT INTO asking_prices (piece_id, cents, from_at) VALUES ($1, $2, $3)", [piece.id, askingPriceCents, now]);
    await db.query("UPDATE pieces SET version = version + 1 WHERE id = $1", [piece.id]);
    return reply(200, { piece: pieceView(await loadPiece(db, now, piece.id), now) });
  });
}

export async function addPhoto({ params, photoFile, now }: Context): Promise<Reply> {
  const type = photoFile && photoTypeOf(photoFile);
  if (!photoFile || !type) throw validationFailed({ photo: PHOTO_MESSAGE });
  const copy = await publicCopyOf(photoFile, type).catch((error: unknown) => {
    if (error instanceof NotAPhoto) throw validationFailed({ photo: PHOTO_MESSAGE });
    throw error;
  });
  return transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (piece.photos.length >= MAX_PHOTOS) throw conflict("photo_limit", "A piece can have at most 6 photos.");
    const id = randomUUID();
    const prefix = `pieces/${piece.id}/photos/${id}`;
    try {
      await putObject(`${prefix}/original`, photoFile, type);
      await putObject(`${prefix}/public`, copy.bytes, type);
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
      await deleteObject(`${prefix}/original`).catch(() => undefined);
      throw storageUnavailable(STORAGE_DOWN_COPY);
    }
    const createdAt = new Date(now.getTime() - (now.getTime() % 1000));
    await db.query("INSERT INTO photos (id, piece_id, content_type, original_type, width, height, created_at) VALUES ($1, $2, $3, $3, $4, $5, $6)", [id, piece.id, type, copy.width, copy.height, createdAt]);
    const stored = (await loadPiece(db, now, piece.id)).photos.find((photo) => photo.id === id);
    return reply(201, { photo: stored });
  });
}

interface PhotoRow {
  piece_id: string;
  content_type: string;
  original_type: string;
}

const photoRows = (id: string) => pool.query<PhotoRow>("SELECT piece_id, content_type, original_type FROM photos WHERE id = $1", [id]);

export async function photoExists({ params }: Context): Promise<void> {
  if (!isUuid(params.id) || !(await photoRows(params.id)).rows.length) throw notFound();
}

const STORE_DOWN = "Photos can't be read right now. Try again in a moment.";

async function storedPhoto(key: string): Promise<Buffer> {
  return getObject(key).catch((error: unknown) => {
    if (error instanceof StorageDown) throw storageUnavailable(STORE_DOWN);
    throw error;
  });
}

/** A photo is public while the public may see its piece; an unknown id is left to the resource step. */
export async function photoIsPublic({ id }: Record<string, string>, now: Date): Promise<boolean> {
  if (!isUuid(id)) return true;
  const { rows: [row] } = await photoRows(id);
  return !row || shownToPublic(await loadPiece(pool, now, row.piece_id));
}

export async function publicPhoto({ params }: Context): Promise<Reply> {
  const { rows: [row] } = await photoRows(params.id);
  return file(await storedPhoto(`pieces/${row.piece_id}/photos/${params.id}/public`), row.content_type);
}

export async function originalPhoto({ params }: Context): Promise<Reply> {
  const { rows: [row] } = await photoRows(params.id);
  return file(await storedPhoto(`pieces/${row.piece_id}/photos/${params.id}/original`), row.original_type, { "Content-Disposition": "attachment" });
}

const ARCHIVABLE: readonly string[] = ["on_rail", "returns_shelf", "donation_box", "returned"];

export async function archivePiece({ params, now }: Context): Promise<Reply> {
  return transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (!ARCHIVABLE.includes(piece.status)) throw conflict("cannot_archive", "A piece on hold, sold or already archived can't be archived.");
    await db.query("UPDATE pieces SET archived_at = $2 WHERE id = $1", [piece.id, now]);
    return reply(200, { piece: pieceView(await loadPiece(db, now, piece.id), now) });
  });
}

export async function restorePiece({ params, now }: Context): Promise<Reply> {
  return transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (piece.status !== "archived") throw conflict("not_archived", "This piece is not archived.");
    if (piece.consignorStatus !== "active") throw conflict("consignor_erased", "This piece's consignor was erased.");
    await db.query("UPDATE pieces SET archived_at = NULL WHERE id = $1", [piece.id]);
    return reply(200, { piece: pieceView(await loadPiece(db, now, piece.id), now) });
  });
}

export async function markCollected({ params, now }: Context): Promise<Reply> {
  return transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (piece.status !== "returns_shelf") throw conflict("not_on_returns_shelf", "This piece is not on the Returns shelf.");
    await db.query("UPDATE pieces SET collected_at = $2 WHERE id = $1", [piece.id, now]);
    return reply(200, { piece: pieceView(await loadPiece(db, now, piece.id), now) });
  });
}
