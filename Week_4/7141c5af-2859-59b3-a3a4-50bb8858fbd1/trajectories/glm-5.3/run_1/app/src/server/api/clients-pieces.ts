import { Router, type Request, type Response } from "express";
import { q, q1, tx } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { towns, isoZ } from "../time.js";
import { newToken } from "../config.js";
import { luhnValid } from "../stamps.js";
import { decParse } from "../decimal.js";
import { meili } from "../providers/meili.js";
import { syncEntries } from "../sync.js";

export const clientsRouter = Router({ mergeParams: true });
export const piecesRouter = Router({ mergeParams: true });

const CLIENT_NAME_MAX = 120;
const TITLE_MAX = 120;
const MAKER_MAX = 120;
const YEAR_MAX = 40;
const NOTES_MAX = 2000;
const EMAIL_MAX = 254;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= EMAIL_MAX;

export const clientJson = (row: { id: string; name: string; town: string; language: string; email: string; state: string; closes_at: Date | null }) => ({
  id: row.id,
  name: row.state === "erased" ? "Erased client" : row.name,
  town: row.state === "erased" ? "" : row.town,
  language: row.state === "erased" ? "" : row.language,
  email: row.state === "erased" ? "" : row.email,
  state: row.state,
  closesAt: row.closes_at ? isoZ(row.closes_at) : null,
});

export async function clientOfDesk(deskId: string, id: string) {
  const row = await q1<{ id: string; name: string; town: string; language: string; email: string; state: string; closes_at: Date | null }>(
    "SELECT id, name, town, language, email, state, closes_at FROM clients WHERE id = $1 AND desk_id = $2",
    [id, deskId]
  );
  if (!row || row.state === "erasing" || row.state === "erased") return null;
  return row;
}

clientsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const rows = await q<{ id: string; name: string; town: string; language: string; email: string; state: string; closes_at: Date | null }>("SELECT id, name, town, language, email, state, closes_at FROM clients WHERE desk_id = $1 ORDER BY name", [session.deskId]);
  res.json({ clients: rows.map(clientJson) });
}));

clientsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const name = (str(body.name) ?? "").trim();
  const town = str(body.town);
  const language = str(body.language) ?? null;
  const email = (str(body.email) ?? "").trim();
  const fields: Record<string, string> = {};
  if (name === "") fields.name = apiMessages.fieldRequired;
  else if (name.length > CLIENT_NAME_MAX) fields.name = apiMessages.fieldLong(CLIENT_NAME_MAX);
  const townV = town ?? "";
  if (!(towns as string[]).includes(townV)) fields.town = apiMessages.fieldRequired;
  if (email !== "" && !emailOk(email)) fields.email = apiMessages.email;
  if (language && !["en", "it", "ja", "ar"].includes(language)) fields.language = apiMessages.fieldRequired;
  if (Object.keys(fields).length) throw err.field(fields);
  const id = newToken(8);
  await q("INSERT INTO clients (id, desk_id, name, town, language, email) VALUES ($1,$2,$3,$4,$5,$6)", [
    id, session.deskId, name, townV, language ?? townLanguageDefault(townV), email,
  ]);
  const row = await clientOfDesk(session.deskId, id);
  await syncEntries(session.deskId, [{ kind: "client", refId: id, label: name, href: `/clients/${id}` }]);
  res.status(201).json({ client: clientJson(row!) });
}));

const townLanguageDefault = (town: string): string =>
  ({ Turin: "it", London: "en", "New York": "en", Kyoto: "ja", Dubai: "ar" })[town] ?? "en";

clientsRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const row = await clientOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  res.json({ client: clientJson(row) });
}));

clientsRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await clientOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const name = body.name !== undefined ? str(body.name) : row.name;
  const town = body.town !== undefined ? str(body.town) : row.town;
  const language = body.language !== undefined ? str(body.language) : row.language;
  const email = body.email !== undefined ? (str(body.email) ?? "").trim() : row.email;
  const fields: Record<string, string> = {};
  const nameV = (name ?? "").trim();
  if (nameV === "") fields.name = apiMessages.fieldRequired;
  else if (nameV.length > CLIENT_NAME_MAX) fields.name = apiMessages.fieldLong(CLIENT_NAME_MAX);
  if (!town || !(towns as string[]).includes(town)) fields.town = apiMessages.fieldRequired;
  if (email !== "" && !emailOk(email)) fields.email = apiMessages.email;
  if (!language || !["en", "it", "ja", "ar"].includes(language)) fields.language = apiMessages.fieldRequired;
  if (Object.keys(fields).length) throw err.field(fields);
  await q("UPDATE clients SET name=$1, town=$2, language=$3, email=$4 WHERE id=$5", [nameV, town, language, email, row.id]);
  await syncEntries(session.deskId, [{ kind: "client", refId: row.id, label: nameV, href: `/clients/${row.id}` }]);
  const updated = await clientOfDesk(session.deskId, row.id);
  res.json({ client: clientJson(updated!) });
}));

clientsRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await clientOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  const pieces = await q1<{ n: string }>("SELECT count(*)::text AS n FROM pieces WHERE client_id = $1", [row.id]);
  if (pieces && Number(pieces.n) > 0) throw err.state("F-98", apiMessages.hasPieces);
  await q("DELETE FROM clients WHERE id = $1", [row.id]);
  await syncEntries(session.deskId, [{ kind: "client", refId: row.id, label: "", href: "", remove: true }]);
  res.status(204).end();
}));

clientsRouter.post("/:id/close", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await clientOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  await readJsonBody(req);
  await q("UPDATE clients SET state='closing', closes_at=now() WHERE id=$1", [row.id]);
  const updated = await clientOfDesk(session.deskId, row.id);
  res.json({ client: clientJson(updated!) });
}));

clientsRouter.post("/:id/bring-back", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await clientOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  if (row.state !== "closing") throw err.notFound();
  const waitMs = (await import("../config.js")).config.timers.closureWait * 1000;
  if (row.closes_at && Date.now() - row.closes_at.getTime() >= waitMs) {
    throw err.state("F-110", apiMessages.bringBackTooLate);
  }
  await q("UPDATE clients SET state='active', closes_at=NULL WHERE id=$1", [row.id]);
  const updated = await clientOfDesk(session.deskId, row.id);
  res.json({ client: clientJson(updated!) });
}));

// ---- Pieces ----

export const PIECE_STATES = ["received", "inSurvey", "onTheBench", "ready", "collected", "archived"] as const;
export type PieceState = (typeof PIECE_STATES)[number];

export const pieceJson = (row: Record<string, unknown>) => ({
  id: row.id,
  clientId: row.client_id,
  title: row.title,
  maker: row.maker,
  year: row.year,
  stampNumber: row.stamp_number,
  widthCm: row.width_cm === null ? null : Number(row.width_cm),
  depthCm: row.depth_cm === null ? null : Number(row.depth_cm),
  heightCm: row.height_cm === null ? null : Number(row.height_cm),
  weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
  dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
  notes: row.notes,
  state: row.state,
  createdAt: isoZ(row.created_at as Date),
});

export async function pieceOfDesk(deskId: string, id: string) {
  const row = await q1("SELECT * FROM pieces WHERE id = $1 AND desk_id = $2", [id, deskId]);
  if (!row) return null;
  if (row.due_date instanceof Date) {
    row.due_date = row.due_date.toISOString().slice(0, 10);
  }
  return row;
}

const numberField = (v: unknown, allowEmpty: boolean): { value: number | null; error?: string } => {
  if (v === undefined || v === null || v === "") {
    return allowEmpty ? { value: null } : { value: null, error: apiMessages.fieldRequired };
  }
  if (typeof v === "number" && Number.isFinite(v)) return { value: v };
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return { value: Number(v) };
  return { value: null, error: apiMessages.notANumber };
};

piecesRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const client = typeof req.query.client === "string" && req.query.client !== "" ? req.query.client : null;
  const state = typeof req.query.state === "string" && req.query.state !== "" ? req.query.state : null;
  const sort = req.query.sort === "dueDate" ? "dueDate" : "title";
  const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : null;
  const limit = 25;
  const params: unknown[] = [session.deskId];
  let where = "desk_id = $1";
  if (client) {
    const owned = await q1<{ id: string }>("SELECT id FROM clients WHERE id=$1 AND desk_id=$2", [client, session.deskId]);
    if (!owned) throw err.notFound();
    params.push(client);
    where += ` AND client_id = $${params.length}`;
  }
  if (state) {
    params.push(state);
    where += ` AND state = $${params.length}`;
  } else {
    where += " AND state <> 'archived'";
  }
  let order: string;
  if (sort === "dueDate") order = "due_date ASC NULLS LAST, id ASC";
  else order = "title ASC, id ASC";
  if (cursor) {
    const [lastSort, lastId] = decodeURIComponent(cursor).split("~");
    params.push(lastSort, lastId);
    const cmp = sort === "dueDate" ? "(due_date, id)" : "(title, id)";
    where += ` AND ${cmp} > ($${params.length - 1}::text, $${params.length}::text)`;
  }
  const rows = await q(`SELECT * FROM pieces WHERE ${where} ORDER BY ${order} LIMIT ${limit + 1}`, params);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeURIComponent(`${sort === "dueDate" ? (last.due_date ? String(last.due_date).slice(0, 10) : "") : last.title}~${last.id}`)
    : null;
  res.json({ pieces: page.map(pieceJson), nextCursor });
}));

piecesRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);

  if (body.duplicateOf !== undefined) {
    const sourceId = str(body.duplicateOf);
    const source = sourceId ? await pieceOfDesk(session.deskId, sourceId) : null;
    if (!source) throw err.notFound();
    const id = newToken(8);
    const dupeState = await tx(async (client) => {
      const ins = await client.query(
        `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, width_cm, depth_cm, height_cm, weight_kg, due_date, notes, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received') RETURNING *`,
        [id, session.deskId, source.client_id, `${source.title} (copy)`, source.maker, source.year, source.width_cm, source.depth_cm, source.height_cm, source.weight_kg, source.due_date, source.notes]
      );
      await client.query("INSERT INTO layouts (piece_id, desk_id, version, placements, used_sqft, used_percent) VALUES ($1,$2,1,$3,0,0)", [
        id, session.deskId, JSON.stringify([]),
      ]);
      return ins.rows[0]!;
    });
    await syncEntries(session.deskId, [{ kind: "piece", refId: id, label: `${source.title} (copy)`, href: `/pieces/${id}` }]);
    res.status(201).json({ piece: pieceJson(dupeState) });
    return;
  }

  const clientId = str(body.clientId);
  const title = (str(body.title) ?? "").trim();
  const maker = str(body.maker);
  const year = str(body.year);
  const stampNumber = str(body.stampNumber);
  const dueDate = str(body.dueDate);
  const notes = str(body.notes);
  const clientRow = clientId ? await clientOfDesk(session.deskId, clientId) : null;
  const fields: Record<string, string> = {};
  if (!clientId || !clientRow) fields.clientId = apiMessages.fieldRequired;
  if (title === "") fields.title = apiMessages.fieldRequired;
  else if (title.length > TITLE_MAX) fields.title = apiMessages.fieldLong(TITLE_MAX);
  if (maker !== null && maker.length > MAKER_MAX) fields.maker = apiMessages.fieldLong(MAKER_MAX);
  if (year !== null && year.length > YEAR_MAX) fields.year = apiMessages.fieldLong(YEAR_MAX);
  if (stampNumber !== null && stampNumber !== "") {
    if (!/^\d{8}$/.test(stampNumber) || !luhnValid(stampNumber)) fields.stampNumber = apiMessages.stampBad;
  }
  if (dueDate !== null && dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fields.dueDate = apiMessages.date;
  if (notes !== null && notes.length > NOTES_MAX) fields.notes = apiMessages.fieldLong(NOTES_MAX);
  for (const key of ["widthCm", "depthCm", "heightCm", "weightKg"] as const) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== "") {
      const d = decParse(typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
      if (d === null) fields[key] = apiMessages.notANumber;
      else if (d.v < 0n) fields[key] = apiMessages.numberRange;
    }
  }
  if (Object.keys(fields).length) throw err.field(fields);
  if (stampNumber) {
    const taken = await q1<{ id: string }>("SELECT id FROM pieces WHERE desk_id=$1 AND stamp_number=$2", [session.deskId, stampNumber]);
    if (taken) throw err.state("F-14", apiMessages.stampTaken);
  }
  const id = newToken(8);
  const width = numberField(body.widthCm, true).value;
  const depth = numberField(body.depthCm, true).value;
  const height = numberField(body.heightCm, true).value;
  const weight = numberField(body.weightKg, true).value;
  await q(
    `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, stamp_number, width_cm, depth_cm, height_cm, weight_kg, due_date, notes, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'received')`,
    [id, session.deskId, clientId, title, maker, year, stampNumber || null, width, depth, height, weight, dueDate || null, notes ?? "", ]
  );
  await q("INSERT INTO layouts (piece_id, desk_id, version, placements, used_sqft, used_percent) VALUES ($1,$2,1,$3,0,0)", [id, session.deskId, JSON.stringify([])]);
  const row = await pieceOfDesk(session.deskId, id);
  await syncEntries(session.deskId, [{ kind: "piece", refId: id, label: title.trim(), href: `/pieces/${id}` }]);
  res.status(201).json({ piece: pieceJson(row!) });
}));

piecesRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const row = await pieceOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  res.json({ piece: pieceJson(row) });
}));

piecesRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await pieceOfDesk(session.deskId, req.params.id!);
  if (!row) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const fields: Record<string, string> = {};
  const updates: Record<string, unknown> = {};
  const state = str(body.state);
  if (state !== null) {
    if (!(PIECE_STATES as readonly string[]).includes(state)) fields.state = apiMessages.numberRange;
    else updates.state = state;
  }
  const title = body.title !== undefined ? str(body.title) : undefined;
  if (title !== undefined) {
    const t = (title ?? "").trim();
    if (t === "") fields.title = apiMessages.fieldRequired;
    else if (t.length > TITLE_MAX) fields.title = apiMessages.fieldLong(TITLE_MAX);
    else updates.title = t;
  }
  const stampNumber = body.stampNumber !== undefined ? str(body.stampNumber) : undefined;
  if (stampNumber !== undefined) {
    if (stampNumber !== null && stampNumber !== "") {
      if (!/^\d{8}$/.test(stampNumber) || !luhnValid(stampNumber)) fields.stampNumber = apiMessages.stampBad;
      else {
        const taken = await q1<{ id: string }>("SELECT id FROM pieces WHERE desk_id=$1 AND stamp_number=$2 AND id<>$3", [session.deskId, stampNumber, row.id]);
        if (taken) throw err.state("F-14", apiMessages.stampTaken);
        updates.stamp_number = stampNumber;
      }
    } else updates.stamp_number = null;
  }
  const maker = body.maker !== undefined ? str(body.maker) : undefined;
  if (maker !== undefined) {
    if (maker !== null && maker.length > MAKER_MAX) fields.maker = apiMessages.fieldLong(MAKER_MAX);
    else updates.maker = maker;
  }
  const year = body.year !== undefined ? str(body.year) : undefined;
  if (year !== undefined) {
    if (year !== null && year.length > YEAR_MAX) fields.year = apiMessages.fieldLong(YEAR_MAX);
    else updates.year = year;
  }
  const notes = body.notes !== undefined ? str(body.notes) : undefined;
  if (notes !== undefined) {
    if (notes !== null && notes.length > NOTES_MAX) fields.notes = apiMessages.fieldLong(NOTES_MAX);
    else updates.notes = notes;
  }
  const dueDate = body.dueDate !== undefined ? str(body.dueDate) : undefined;
  if (dueDate !== undefined) {
    if (dueDate !== null && dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fields.dueDate = apiMessages.date;
    else updates.due_date = dueDate || null;
  }
  for (const key of ["widthCm", "depthCm", "heightCm", "weightKg"] as const) {
    if (body[key] !== undefined) {
      const parsed = numberField(body[key], true);
      if (parsed.error) fields[key] = parsed.error;
      else updates[{ widthCm: "width_cm", depthCm: "depth_cm", heightCm: "height_cm", weightKg: "weight_kg" }[key]!] = parsed.value;
    }
  }
  if (Object.keys(fields).length) throw err.field(fields);
  if (Object.keys(updates).length) {
    const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(", ");
    await q(`UPDATE pieces SET ${sets} WHERE id = $1`, [row.id, ...Object.values(updates)]);
  }
  const updated = await pieceOfDesk(session.deskId, row.id);
  res.json({ piece: pieceJson(updated!) });
}));

void meili;
