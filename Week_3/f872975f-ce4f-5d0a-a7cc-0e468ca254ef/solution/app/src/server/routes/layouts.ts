// Layout files: import (with version 1 migration and kept unknown keys) and byte-stable export.
import { inchesToMm } from "../../shared/domain";
import { one, pool } from "../db";
import { ApiError, Fields, isObject, ok, requireRole, requireUser, route, type Context } from "../http";
import { boardRow, notFound } from "../store";
import { readPieces } from "./boards";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const V2_KEYS = ["format", "version", "board", "unit", "pieces"];
const V1_KEYS = ["format", "version", "board", "unit", "cuts"];
const V2_PIECE = ["label", "length_mm", "width_mm", "start_mm"];
const V1_PIECE: Record<string, string> = { name: "label", len: "length_mm", w: "width_mm", at: "start_mm" };

async function makerBoard(ctx: Context): Promise<{ tag: string; makerId: number }> {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  const row = await boardRow(pool, tag);
  if (row === undefined || (row.status !== "available" && row.status !== "held")) notFound();
  requireRole(user, "maker");
  return { tag, makerId: user.id };
}

const unknownEntries = (obj: Record<string, unknown>, known: string[]): [string, unknown][] =>
  Object.entries(obj).filter(([k]) => !known.includes(k));

const inchValue = (v: unknown): number | null => (typeof v === "number" && v >= 0 ? inchesToMm(String(v)) : null);

/** Runs the five layout file checks in order and returns the stored version 2 object. */
function migrate(file: unknown, tag: string): Record<string, unknown> {
  if (!isObject(file) || file["format"] !== "kerf") throw new ApiError("validation", { format: "The format must be kerf." });
  const version = file["version"];
  if (typeof version === "number" && version > 2) throw new ApiError("unsupported_version");
  if (version !== 1 && version !== 2) throw new ApiError("validation", { version: "The version must be 1 or 2." });
  if (typeof file["board"] !== "string") throw new ApiError("validation", { board: "The board tag is missing." });
  if (file["board"] !== tag) throw new ApiError("wrong_board");
  if (file["unit"] !== (version === 2 ? "mm" : "in")) throw new ApiError("validation", { unit: `Version ${version} files use ${version === 2 ? "mm" : "in"}.` });
  const source = version === 2 ? file["pieces"] : file["cuts"];
  const rawPieces = Array.isArray(source) ? source : [];
  const migrated = rawPieces.map((p: unknown) => {
    if (!isObject(p)) return p;
    if (version === 2) return p;
    const out: Record<string, unknown> = {};
    for (const [k, target] of Object.entries(V1_PIECE)) {
      if (k in p) out[target] = target === "label" ? p[k] : inchValue(p[k]);
    }
    return out;
  });
  const fields = new Fields();
  const pieces = readPieces(Array.isArray(source) ? migrated : source, fields);
  fields.throwIfAny();
  const withExtras = pieces.map((piece, i) => {
    const original = rawPieces[i];
    const extras = isObject(original) ? unknownEntries(original, version === 2 ? V2_PIECE : Object.keys(V1_PIECE)) : [];
    return { ...piece, ...Object.fromEntries(extras) };
  });
  const sorted = withExtras.map((p, i) => ({ p, i })).sort((a, b) => a.p.start_mm - b.p.start_mm || a.i - b.i).map((x) => x.p);
  return {
    format: "kerf", version: 2, board: tag, unit: "mm", pieces: sorted,
    ...Object.fromEntries(unknownEntries(file, version === 2 ? V2_KEYS : V1_KEYS)),
  };
}

route("POST", "/api/boards/:tag/layout", async (ctx) => {
  const { tag, makerId } = await makerBoard(ctx);
  const layout = migrate(ctx.body, tag);
  const text = JSON.stringify(layout);
  await pool.query(
    `INSERT INTO layouts (maker_id, board_tag, body) VALUES ($1, $2, $3)
     ON CONFLICT (maker_id, board_tag) DO UPDATE SET body = EXCLUDED.body`, [makerId, tag, text]);
  return ok({ layout: JSON.parse(text) as Json });
});

route("GET", "/api/boards/:tag/layout.kerf", async (ctx) => {
  const { tag, makerId } = await makerBoard(ctx);
  const row = await one<{ body: string }>(pool, "SELECT body FROM layouts WHERE maker_id = $1 AND board_tag = $2", [makerId, tag]);
  if (row === undefined) notFound();
  return {
    status: 200,
    raw: {
      bytes: Buffer.from(row.body, "utf8"),
      contentType: "application/json",
      headers: { "Content-Disposition": `attachment; filename="${tag}.kerf"` },
    },
  };
});
