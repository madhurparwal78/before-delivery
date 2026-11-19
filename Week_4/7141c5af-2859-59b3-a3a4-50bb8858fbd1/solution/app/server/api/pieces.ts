import { randomUUID } from "node:crypto";
import { UNIQUE_VIOLATION, one, query, type Queryable, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { isStampNumber } from "../domain/luhn.ts";
import { addDays, instant, turinToday } from "../domain/time.ts";
import { conflict, invalid, notFound } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { entryOfPiece, syncEntries } from "../providers/meili.ts";
import { findClient } from "./clients.ts";
import { type Body, bodyOf, checkFields, dateField, optionalDecimal, optionalText, requiredText } from "./fields.ts";
import { findPiece, pieceOf, pieceResource, type PieceRow } from "./resources.ts";

const PAGE_SIZE = 25;
const DUE_SOON_DAYS = 14;
const PIECE_STATES = ["received", "inSurvey", "onTheBench", "ready", "collected", "archived"];

const number = (text: string | null): number | null => (text === null ? null : Number(text));

function pieceBody(row: PieceRow & { created_at?: Date }): Record<string, unknown> {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    title: row.title,
    maker: row.maker,
    year: row.year,
    stampNumber: row.stamp_number,
    widthCm: number(row.width_cm),
    depthCm: number(row.depth_cm),
    heightCm: number(row.height_cm),
    weightKg: number(row.weight_kg),
    dueDate: row.due_date,
    notes: row.notes,
    state: row.state,
    ...(row.created_at ? { createdAt: instant(row.created_at) } : {}),
  };
}

function stampField(body: Body): string | null {
  const stamp = body.stampNumber;
  if (stamp === undefined || stamp === null || stamp === "") return null;
  if (typeof stamp !== "string" || !isStampNumber(stamp)) throw invalid("stampNumber", copy("F-13"));
  return stamp;
}

function dueField(body: Body): string | null {
  return body.dueDate === undefined || body.dueDate === null || body.dueDate === "" ? null : dateField(body, "dueDate");
}

interface PieceFields {
  title: string;
  maker: string | null;
  year: string | null;
  stampNumber: string | null;
  widthCm: string | null;
  depthCm: string | null;
  heightCm: string | null;
  weightKg: string | null;
  dueDate: string | null;
  notes: string | null;
}

/** The fields of a new piece, or of a piece being changed: a key left out of a change keeps what `current` holds. */
function pieceFields(body: Body, current: PieceRow | null): PieceFields {
  const read = <Value>(field: string, check: () => Value, kept: Value) => (): Value => (!current || field in body ? check() : kept);
  return checkFields({
    title: read("title", () => requiredText(body, "title", 120), current?.title as string),
    maker: read("maker", () => optionalText(body, "maker", 120), current?.maker ?? null),
    year: read("year", () => optionalText(body, "year", 40), current?.year ?? null),
    stampNumber: read("stampNumber", () => stampField(body), current?.stamp_number ?? null),
    widthCm: read("widthCm", () => optionalDecimal(body, "widthCm"), current?.width_cm ?? null),
    depthCm: read("depthCm", () => optionalDecimal(body, "depthCm"), current?.depth_cm ?? null),
    heightCm: read("heightCm", () => optionalDecimal(body, "heightCm"), current?.height_cm ?? null),
    weightKg: read("weightKg", () => optionalDecimal(body, "weightKg"), current?.weight_kg ?? null),
    dueDate: read("dueDate", () => dueField(body), current?.due_date ?? null),
    notes: read("notes", () => optionalText(body, "notes", 2000), current?.notes ?? null),
  });
}

/** Turns the desk's unique stamp index into the published refusal. */
async function stampChecked<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw conflict("stampTaken", copy("F-14"));
    throw error;
  }
}

/** A new piece row with its all-in-the-tray layout. */
export async function insertPiece(on: Queryable, deskId: string, clientId: string, fields: PieceFields): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, stamp_number, width_cm, depth_cm, height_cm, weight_kg, due_date, notes, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'received')`,
    [id, deskId, clientId, fields.title, fields.maker, fields.year, fields.stampNumber, fields.widthCm, fields.depthCm, fields.heightCm, fields.weightKg, fields.dueDate, fields.notes],
    on,
  );
  await query("INSERT INTO layouts (piece_id) VALUES ($1)", [id], on);
  return id;
}

async function createPiece(ctx: Ctx, clientId: string, fields: PieceFields): Promise<ReturnType<typeof json>> {
  const id = await stampChecked(() => tx((client) => insertPiece(client, ctx.deskId, clientId, fields)));
  syncEntries([entryOfPiece(ctx.deskId, { id, title: fields.title })]);
  return json(201, { piece: pieceBody((await findPiece(ctx.deskId, id)) as PieceRow) });
}

function duplicateFields(original: PieceRow): PieceFields {
  return {
    title: `${original.title} (copy)`,
    maker: original.maker,
    year: original.year,
    stampNumber: null,
    widthCm: original.width_cm,
    depthCm: original.depth_cm,
    heightCm: original.height_cm,
    weightKg: original.weight_kg,
    dueDate: original.due_date,
    notes: original.notes,
  };
}

type Cursor = [string, string] | [boolean, string, string];

function encodeCursor(row: PieceRow, sort: string): string {
  const cursor: Cursor = sort === "dueDate" ? [row.due_date === null, row.due_date ?? "infinity", row.id] : [row.title.toLowerCase(), row.id];
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(text: string, sort: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as Cursor;
    if (Array.isArray(cursor) && cursor.length === (sort === "dueDate" ? 3 : 2)) return cursor;
  } catch {
    // Falls through to the refusal below.
  }
  throw invalid("cursor", copy("F-08"));
}

const ORDERS: Record<string, { key: string; values: string }> = {
  title: { key: `lower(p.title) COLLATE "C", p.id COLLATE "C"`, values: `$N::text COLLATE "C", $M::text COLLATE "C"` },
  dueDate: { key: `p.due_date IS NULL, COALESCE(p.due_date, 'infinity'), p.id COLLATE "C"`, values: `$N::boolean, $M::date, $L::text COLLATE "C"` },
};

async function listPieces(ctx: Ctx): Promise<ReturnType<typeof json>> {
  const sort = ctx.query.get("sort") || "title";
  const order = Object.hasOwn(ORDERS, sort) ? ORDERS[sort] : undefined;
  if (!order) throw invalid("sort", copy("F-08"));
  const state = ctx.query.get("state") || null;
  if (state && !PIECE_STATES.includes(state)) throw invalid("state", copy("F-08"));
  const params: unknown[] = [ctx.deskId];
  const where = ["p.desk_id = $1", "c.state NOT IN ('erasing', 'erased')"];
  const client = ctx.query.get("client");
  if (client) where.push(`p.client_id = $${params.push(client)}`);
  where.push(state ? `p.state = $${params.push(state)}` : "p.state <> 'archived'");
  const cursorText = ctx.query.get("cursor");
  if (cursorText) {
    const slots = decodeCursor(cursorText, sort).map((value) => `$${params.push(value)}`);
    const values = order.values.replace("$N", slots[0] as string).replace("$M", slots[1] as string).replace("$L", slots[2] ?? "");
    where.push(`(${order.key}) > (${values})`);
  }
  const rows = await query<PieceRow & { created_at: Date }>(
    `SELECT p.*, c.name AS client_name FROM pieces p JOIN clients c ON c.id = p.client_id
     WHERE ${where.join(" AND ")} ORDER BY ${order.key} LIMIT ${PAGE_SIZE + 1}`,
    params,
  );
  const today = turinToday();
  const due = await one<{ count: bigint }>(
    `SELECT count(*) FROM pieces p JOIN clients c ON c.id = p.client_id
     WHERE p.desk_id = $1 AND c.state NOT IN ('erasing', 'erased') AND p.state <> 'archived' AND p.due_date BETWEEN $2 AND $3`,
    [ctx.deskId, today, addDays(today, DUE_SOON_DAYS)],
  );
  const pieces = rows.slice(0, PAGE_SIZE);
  const last = pieces.at(-1);
  return json(200, {
    pieces: pieces.map(pieceBody),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last, sort) : null,
    dueSoon: Number(due?.count ?? 0n),
  });
}

async function ownClient(ctx: Ctx, body: Body): Promise<void> {
  if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
    if (typeof body.clientId !== "string" || !(await findClient(ctx.deskId, body.clientId))) throw notFound();
  }
}

export function register(): void {
  route({ method: "GET", pattern: "/api/pieces", handle: listPieces });

  route({
    method: "POST",
    pattern: "/api/pieces",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      if ("duplicateOf" in body) {
        const original = typeof body.duplicateOf === "string" ? await findPiece(ctx.deskId, body.duplicateOf) : null;
        if (!original) throw notFound();
        return createPiece(ctx, original.client_id, duplicateFields(original));
      }
      await ownClient(ctx, body);
      const checked = checkFields({ clientId: () => requiredText(body, "clientId", 200), fields: () => pieceFields(body, null) });
      return createPiece(ctx, checked.clientId, checked.fields);
    },
  });

  route({ method: "GET", pattern: "/api/pieces/:id", resource: pieceResource, handle: async (ctx) => json(200, { piece: pieceBody(pieceOf(ctx)) }) });

  route({
    method: "PATCH",
    pattern: "/api/pieces/:id",
    resource: pieceResource,
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const piece = pieceOf(ctx);
      await ownClient(ctx, body);
      const checked = checkFields({
        clientId: () => ("clientId" in body ? requiredText(body, "clientId", 200) : piece.client_id),
        state: () => {
          if (!("state" in body)) return piece.state;
          if (!PIECE_STATES.includes(body.state as string)) throw invalid("state", copy("F-08"));
          return body.state as string;
        },
        fields: () => pieceFields(body, piece),
      });
      const { fields } = checked;
      await stampChecked(() =>
        query(
          `UPDATE pieces SET client_id = $2, state = $3, title = $4, maker = $5, year = $6, stamp_number = $7, width_cm = $8, depth_cm = $9,
             height_cm = $10, weight_kg = $11, due_date = $12, notes = $13 WHERE id = $1`,
          [piece.id, checked.clientId, checked.state, fields.title, fields.maker, fields.year, fields.stampNumber, fields.widthCm, fields.depthCm, fields.heightCm, fields.weightKg, fields.dueDate, fields.notes],
        ),
      );
      if (fields.title !== piece.title) syncEntries([entryOfPiece(ctx.deskId, { id: piece.id, title: fields.title })]);
      return json(200, { piece: pieceBody((await findPiece(ctx.deskId, piece.id)) as PieceRow) });
    },
  });
}

