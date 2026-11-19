import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler, HttpError } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin, PHOTO_LIMIT } from "../request.js";
import { sha256, newToken } from "../config.js";
import { isPngOrJpeg } from "../png.js";
import { s3 } from "../providers/s3.js";
import { isoZ } from "../time.js";
import { pieceOfDesk } from "./clients-pieces.js";

export const pinsRouter = Router({ mergeParams: true });
export const photosRouter = Router({ mergeParams: true });

const NOTE_MAX = 2000;
const PIN_KINDS = ["tear", "crack", "stain", "looseJoint", "woodworm"] as const;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

type PinRow = { id: string; number: number; x: string; y: string; kind: string; note: string; signed: boolean };
type PhotoRow = { id: string; number: number; side: string; sha256: string; bytes: number; state: string; created_at: Date };

const pinJson = (r: PinRow) => ({
  id: r.id,
  number: r.number,
  x: Number(r.x),
  y: Number(r.y),
  kind: r.kind,
  note: r.note,
  signed: r.signed,
});

const parseCoord = (v: unknown, field: string): number | "invalid" | "nonNumeric" => {
  if (v === null || v === undefined || typeof v === "boolean") return "nonNumeric";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "nonNumeric";
    if (v < 0 || v > 100) return "invalid";
    return Math.round(v * 10) / 10;
  }
  if (typeof v === "string") {
    if (/^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v);
      if (n < 0 || n > 100) return "invalid";
      return Math.round(n * 10) / 10;
    }
    return "nonNumeric";
  }
  return "nonNumeric";
};

pinsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const rows = await q<PinRow>("SELECT id, number, x, y, kind, note, signed FROM pins WHERE piece_id = $1 ORDER BY y, x", [piece.id]);
  res.json({ pins: rows.map(pinJson) });
}));

pinsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const fields: Record<string, string> = {};
  const x = parseCoord(body.x, "x");
  const y = parseCoord(body.y, "y");
  if (x === "nonNumeric") fields.x = apiMessages.notANumber;
  else if (x === "invalid") fields.x = apiMessages.numberRange;
  if (y === "nonNumeric") fields.y = apiMessages.notANumber;
  else if (y === "invalid") fields.y = apiMessages.numberRange;
  const kind = str(body.kind);
  if (!kind || !(PIN_KINDS as readonly string[]).includes(kind)) fields.kind = apiMessages.fieldRequired;
  const note = str(body.note) ?? "";
  if (note.length > NOTE_MAX) fields.note = apiMessages.fieldLong(NOTE_MAX);
  const signed = body.signed === true;
  if (Object.keys(fields).length) throw err.field(fields);
  const next = await q1<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM pins WHERE piece_id = $1", [piece.id]);
  const id = newToken(8);
  await q("INSERT INTO pins (id, piece_id, desk_id, number, x, y, kind, note, signed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id, piece.id, session.deskId, next!.n, x as number, y as number, kind, note, signed,
  ]);
  const row = await q1<PinRow>("SELECT id, number, x, y, kind, note, signed FROM pins WHERE id = $1", [id]);
  res.status(201).json({ pin: pinJson(row!) });
}));

pinsRouter.delete("/:pinId", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1("SELECT id FROM pins WHERE id = $1 AND piece_id = $2", [req.params.pinId, piece.id]);
  if (!row) throw err.notFound();
  await q("DELETE FROM pins WHERE id = $1", [row.id]);
  res.status(204).end();
}));

// ---- Photographs ----

const photoJson = (r: PhotoRow) => ({
  id: r.id,
  number: r.number,
  side: r.side,
  sha256: r.sha256,
  bytes: r.bytes,
  state: r.state,
  createdAt: isoZ(r.created_at),
});

export async function readMultipart(req: Request): Promise<Map<string, { value: string | Buffer; filename?: string }>> {
  const parts = new Map<string, { value: string | Buffer; filename?: string }>();
  const contentType = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) throw new HttpError(415, "wrongType", "Use multipart.");
  const boundary = `--${m[1] ?? m[2]}`;
  // express.raw has already buffered the whole body.
  const buffered = (req as Request & { body?: unknown }).body;
  const body = Buffer.isBuffer(buffered) ? buffered : Buffer.from(buffered as string ?? "");
  if (body.length > PHOTO_LIMIT + 2_000_000) throw err.tooLarge(apiMessages.photoTooBig);
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    let part = body.subarray(start, next);
    if (part[0] === 13 && part[1] === 10) part = part.subarray(2);
    if (part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const content = part.subarray(headerEnd + 4);
      if (nameMatch) {
        parts.set(nameMatch[1]!, { value: content, filename: fileMatch?.[1] });
      }
    }
    idx = next;
  }
  return parts;
}

photosRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const rows = await q<PhotoRow>("SELECT id, number, side, sha256, bytes, state, created_at FROM photographs WHERE piece_id = $1 ORDER BY number", [piece.id]);
  res.json({ photographs: rows.map(photoJson) });
}));

photosRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  if ((req.headers["content-type"] ?? "").startsWith("application/json")) throw err.wrongType();
  const parts = await readMultipart(req);
  const file = parts.get("file");
  const sidePart = parts.get("side");
  const side = sidePart ? sidePart.value.toString("utf8").trim() : "before";
  if (side !== "before" && side !== "after") throw err.field({ side: apiMessages.fieldRequired });
  if (!file) throw err.field({ file: apiMessages.fieldRequired });
  const bytes = file.value as Buffer;
  if (bytes.length > PHOTO_LIMIT) throw err.tooLarge(apiMessages.photoTooBig);
  if (!isPngOrJpeg(bytes)) throw err.field({ file: apiMessages.notAPhoto });
  const sha = sha256(bytes);
  const dup = await q1<{ id: string; number: number }>("SELECT id, number FROM photographs WHERE piece_id = $1 AND sha256 = $2", [piece.id, sha]);
  if (dup) throw err.state("F-26", apiMessages.photoDuplicate(dup.number));
  const next = await q1<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM photographs WHERE piece_id = $1", [piece.id]);
  const id = newToken(8);
  const key = `photographs/${session.deskId}/${piece.id}/${sha}`;
  const stored = await s3.put(key, bytes, isPngOrJpeg(bytes) && bytes[0] === 0x89 ? "image/png" : "image/jpeg");
  if (!stored) throw err.unavailable(apiMessages.storageDown);
  await q("INSERT INTO photographs (id, piece_id, desk_id, number, side, sha256, bytes, state) VALUES ($1,$2,$3,$4,$5,$6,$7,'stored')", [
    id, piece.id, session.deskId, next!.n, side, sha, bytes.length,
  ]);
  const row = await q1<PhotoRow>("SELECT id, number, side, sha256, bytes, state, created_at FROM photographs WHERE id = $1", [id]);
  res.status(201).json({ photograph: photoJson(row!) });
}));

photosRouter.get("/:photoId/file", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ id: string; sha256: string; state: string }>("SELECT id, sha256, state FROM photographs WHERE id = $1 AND piece_id = $2", [req.params.photoId, piece.id]);
  if (!row) throw err.notFound();
  const key = `photographs/${session.deskId}/${piece.id}/${row.sha256}`;
  const bytes = await s3.get(key);
  if (!bytes) throw err.unavailable(apiMessages.storageDown);
  res.setHeader("Content-Type", row.sha256 ? "application/octet-stream" : "application/octet-stream");
  res.send(bytes);
}));

photosRouter.get("/:photoId/raw", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ sha256: string }>("SELECT sha256 FROM photographs WHERE id = $1 AND piece_id = $2", [req.params.photoId, piece.id]);
  if (!row) throw err.notFound();
  const bytes = await s3.get(`photographs/${session.deskId}/${piece.id}/${row.sha256}`);
  if (!bytes) throw err.unavailable(apiMessages.storageDown);
  res.setHeader("Content-Type", "image/png");
  res.send(bytes);
}));
