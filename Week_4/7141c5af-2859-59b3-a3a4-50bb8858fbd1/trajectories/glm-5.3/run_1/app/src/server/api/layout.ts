import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import {
  FLAWS, HIDE_AREA_SQFT, HIDE_HEIGHT_CM, HIDE_WIDTH_CM, PATTERN_ORDER, checkPlacement, decidePlacement,
  isPatternName, usedFigure, type PatternName, type Rotation,
} from "../hide.js";
import { isoZ, localTimeHM } from "../time.js";

export const layoutRouter = Router({ mergeParams: true });

type PlacedRow = { name: PatternName; x: number; y: number; rotation: Rotation; state: "tray" | "placed" };
type LayoutRow = { piece_id: string; version: number; placements: PlacedRow[]; used_sqft: string; used_percent: string; changed_at: Date };

const layoutJson = (row: LayoutRow) => ({
  layout: {
    version: row.version,
    hide: { widthCm: HIDE_WIDTH_CM, heightCm: HIDE_HEIGHT_CM, areaSqFt: HIDE_AREA_SQFT, flaws: FLAWS },
    pieces: row.placements.map((p) =>
      p.state === "placed" ? { name: p.name, width: patternWidth(p.name), height: patternHeight(p.name), x: p.x, y: p.y, rotation: p.rotation, state: "placed" }
        : { name: p.name, width: patternWidth(p.name), height: patternHeight(p.name), state: "tray" }
    ),
    usedSqFt: row.used_sqft,
    usedPercent: row.used_percent,
    changedAt: isoZ(row.changed_at),
  },
});

const patternWidth = (n: PatternName) => ({ Seat: 62, Back: 62, "Left side": 30, "Right side": 30, Headrest: 40 })[n]!;
const patternHeight = (n: PatternName) => ({ Seat: 58, Back: 74, "Left side": 74, "Right side": 74, Headrest: 22 })[n]!;

async function loadLayout(pieceId: string): Promise<LayoutRow> {
  const row = await q1<{ piece_id: string; version: number; placements: PlacedRow[]; used_sqft: string; used_percent: string; changed_at: Date }>(
    "SELECT piece_id, version, placements, used_sqft, used_percent, changed_at FROM layouts WHERE piece_id = $1", [pieceId]
  );
  if (!row) throw new Error("layout missing");
  return normalizeLayout(row);
}

/** Every change works on all five pieces in their published order. */
export function normalizeLayout(row: { piece_id: string; version: number; placements: PlacedRow[]; used_sqft: string; used_percent: string; changed_at: Date }): LayoutRow {
  const byName = new Map(row.placements.map((p) => [p.name, p]));
  const placements = PATTERN_ORDER.map((name) => {
    const existing = byName.get(name);
    if (existing && existing.state === "placed") {
      return { name, x: Number(existing.x), y: Number(existing.y), rotation: existing.rotation, state: "placed" as const };
    }
    return { name, x: 0, y: 0, rotation: 0 as Rotation, state: "tray" as const };
  });
  return { ...row, placements };
}

export async function ensureLayout(deskId: string, pieceId: string): Promise<LayoutRow> {
  const existing = await q1<{ piece_id: string }>("SELECT piece_id FROM layouts WHERE piece_id = $1", [pieceId]);
  if (existing) return loadLayout(pieceId);
  await q("INSERT INTO layouts (piece_id, desk_id, version, placements, used_sqft, used_percent) VALUES ($1,$2,1,$3,0,0) ON CONFLICT (piece_id) DO NOTHING", [
    pieceId, deskId, JSON.stringify([]),
  ]);
  return loadLayout(pieceId);
}

async function recompute(layout: PlacedRow[]): Promise<{ usedSqFt: string; usedPercent: string }> {
  const placed = layout.filter((p) => p.state === "placed");
  return usedFigure(placed.map((p) => ({ name: p.name, rotation: p.rotation })));
}

layoutRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const layout = await ensureLayout(session.deskId, piece.id);
  res.json(layoutJson(layout));
}));

layoutRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const current = await ensureLayout(session.deskId, piece.id);
  const version = body.version;
  if (version !== undefined && Number(version) !== current.version) {
    throw err.stale("F-51", apiMessages.layoutStale.replace("<time>", localTimeHM(current.changed_at, "Europe/Rome")));
  }
  const placements = Array.isArray(body.placements) ? body.placements : [];
  const checked: PlacedRow[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    const pb = asBody(p);
    const name = typeof pb.name === "string" ? pb.name : null;
    if (!name || !isPatternName(name) || seen.has(name)) throw err.field({ placements: apiMessages.notANumber });
    seen.add(name);
    const decision = decidePlacement(name, { x: pb.x, y: pb.y, rotation: pb.rotation }, checked.filter((c) => c.state === "placed"));
    if (!decision.ok) throw err.field({ placements: decision.message });
    const x = typeof pb.x === "number" ? pb.x : Number(pb.x);
    const y = typeof pb.y === "number" ? pb.y : Number(pb.y);
    checked.push({ name, x, y, rotation: pb.rotation as Rotation, state: "placed" });
  }
  for (const name of PATTERN_ORDER) {
    if (!seen.has(name)) checked.push({ name, x: 0, y: 0, rotation: 0, state: "tray" });
  }
  const ordered = PATTERN_ORDER.map((n) => checked.find((c) => c.name === n)!);
  const figure = await recompute(ordered.filter((p) => p.state === "placed"));
  const nextVersion = current.version + 1;
  await q("UPDATE layouts SET placements=$1, version=$2, used_sqft=$3, used_percent=$4, changed_at=now() WHERE piece_id=$5", [
    JSON.stringify(ordered), nextVersion, figure.usedSqFt, figure.usedPercent, piece.id,
  ]);
  res.json(layoutJson(await loadLayout(piece.id)));
}));

layoutRouter.put("/placements/:name", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const name = req.params.name!;
  if (!isPatternName(name)) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const current = await ensureLayout(session.deskId, piece.id);
  const version = body.version;
  if (version === undefined || Number(version) !== current.version) {
    throw err.stale("F-51", apiMessages.layoutStale.replace("<time>", localTimeHM(current.changed_at, "Europe/Rome")));
  }
  const others = current.placements.filter((p) => p.state === "placed" && p.name !== name);
  const decision = decidePlacement(name, { x: body.x, y: body.y, rotation: body.rotation }, others);
  if (!decision.ok) {
    if (decision.code === "F-47" || decision.code === "F-48" || decision.code === "F-49") throw err.field({ [name]: decision.message });
    if (decision.code === "F-50") throw err.field({ [name]: decision.message });
    throw err.field({ [name]: decision.message });
  }
  const x = typeof body.x === "number" ? body.x : Number(body.x);
  const y = typeof body.y === "number" ? body.y : Number(body.y);
  const rotation = body.rotation as Rotation;
  const next = current.placements.map((p) => (p.name === name ? { ...p, x, y, rotation, state: "placed" as const } : p));
  const figure = await recompute(next.filter((p) => p.state === "placed"));
  await q("UPDATE layouts SET placements=$1, version=$2, used_sqft=$3, used_percent=$4, changed_at=now() WHERE piece_id=$5", [
    JSON.stringify(next), current.version + 1, figure.usedSqFt, figure.usedPercent, piece.id,
  ]);
  res.json(layoutJson(await loadLayout(piece.id)));
}));

layoutRouter.delete("/placements/:name", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const name = req.params.name!;
  if (!isPatternName(name)) throw err.notFound();
  const current = await ensureLayout(session.deskId, piece.id);
  const version = req.query.version;
  if (typeof version !== "string" || Number(version) !== current.version) {
    throw err.stale("F-51", apiMessages.layoutStale.replace("<time>", localTimeHM(current.changed_at, "Europe/Rome")));
  }
  const next = current.placements.map((p) => (p.name === name ? { name: p.name, x: 0, y: 0, rotation: 0 as Rotation, state: "tray" as const } : p));
  const figure = await recompute(next.filter((p) => p.state === "placed"));
  await q("UPDATE layouts SET placements=$1, version=$2, used_sqft=$3, used_percent=$4, changed_at=now() WHERE piece_id=$5", [
    JSON.stringify(next), current.version + 1, figure.usedSqFt, figure.usedPercent, piece.id,
  ]);
  res.json(layoutJson(await loadLayout(piece.id)));
}));

void checkPlacement;
