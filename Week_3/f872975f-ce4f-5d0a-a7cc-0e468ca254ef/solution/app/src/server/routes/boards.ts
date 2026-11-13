// Lots, boards, intake, grading and listing, lineage corrections and the lineage tree.
import type { Lot } from "../../shared/api";
import {
  BOARD_STATUSES, fitLayout, isDefectKind, isGrade, isSpecies, volumeMm3,
  type BoardStatus, type DefectZone, type Grade,
} from "../../shared/domain";
import { one, pool, query, withTransaction } from "../db";
import { ApiError, Fields, isObject, isStaff, ok, requireRole, requireUser, route, type Context } from "../http";
import {
  balance, boardDetail, boardFigures, boardRow, boardRows, boardSummary, descendantsInOrder, isOpen, iso, lockLineage,
  nextTag, notFound, now, ratesInForce, ticketStatusOf, visibleTo, writeMovement, type BoardRow,
} from "../store";

const LIMITS = { length: [300, 12_000], width: [20, 600], thickness: [10, 400] } as const;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const within = (v: unknown, [lo, hi]: readonly [number, number]): v is number => isInt(v) && v >= lo && v <= hi;

// ---- lots ----

interface LotRow {
  id: string;
  name: string;
  origin: string;
  built_year: number;
}

route("GET", "/api/lots", async () => {
  const lots = await query<LotRow>(pool, "SELECT id, name, origin, built_year FROM lots ORDER BY id");
  return ok({ lots: lots.map((l): Lot => ({ id: l.id, name: l.name, origin: l.origin, built_year: l.built_year })) });
});

route("POST", "/api/lots", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "owner", "hand");
  const b = isObject(ctx.body) ? ctx.body : {};
  const fields = new Fields();
  const name = typeof b["name"] === "string" ? b["name"].trim() : "";
  const origin = typeof b["origin"] === "string" ? b["origin"].trim() : "";
  if (name.length < 1 || name.length > 80) fields.add("name", "Enter a name of 1 to 80 characters.");
  if (origin.length < 1 || origin.length > 200) fields.add("origin", "Enter an origin of 1 to 200 characters.");
  if (!within(b["built_year"], [1600, 2026])) fields.add("built_year", "Enter a year from 1600 to 2026.");
  fields.throwIfAny();
  const row = await one<{ n: number }>(pool, "SELECT nextval('lot_seq')::int AS n");
  const id = `LOT-${String(row?.n ?? 0).padStart(2, "0")}`;
  await pool.query("INSERT INTO lots (id, name, origin, built_year, created_at) VALUES ($1, $2, $3, $4, now())",
    [id, name, origin, b["built_year"]]);
  return ok({ lot: { id, name, origin, built_year: b["built_year"] } }, 201);
});

// ---- reading boards ----

function filterValues(url: URL, name: string): string[] {
  return url.searchParams.getAll(name);
}

route("GET", "/api/boards", async (ctx) => {
  const { url } = ctx;
  const staff = isStaff(ctx.user);
  const fields = new Fields();
  const species = filterValues(url, "species");
  const grades = filterValues(url, "grade");
  const statuses = staff ? filterValues(url, "status") : [];
  const numeric = (name: string): number | null => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return null;
    if (!/^\d+$/.test(raw) || Number(raw) > 12_000) {
      fields.add(name, "Enter a whole number from 0 to 12000.");
      return null;
    }
    return Number(raw);
  };
  const minLength = numeric("min_length_mm");
  const minClear = numeric("min_clear_mm");
  if (statuses.some((s) => !(BOARD_STATUSES as readonly string[]).includes(s))) fields.add("status", "Unknown status.");
  fields.throwIfAny();
  const lot = url.searchParams.get("lot");
  const wanted = statuses.length > 0 ? statuses : ["available", "held"];
  const rows = await boardRows(pool, "b.status = ANY($1)", [wanted]);
  const { table } = await ratesInForce(pool, now());
  const boards = rows
    .filter((r) => species.length === 0 || species.includes(r.species))
    .filter((r) => grades.length === 0 || (r.grade !== null && grades.includes(r.grade)))
    .filter((r) => minLength === null || r.length_mm >= minLength)
    .filter((r) => lot === null || lot === "" || r.lot_id === lot)
    .map((r) => boardSummary(r, table))
    .filter((b) => minClear === null || b.longest_clear_mm >= minClear);
  return ok({ count: boards.length, boards });
});

export async function visibleBoard(ctx: Context, tag: string): Promise<BoardRow> {
  const row = await boardRow(pool, tag);
  if (row === undefined || !visibleTo(row, isStaff(ctx.user))) notFound();
  return row;
}

route("GET", "/api/boards/:tag", async (ctx) => {
  const row = await visibleBoard(ctx, ctx.params["tag"] ?? "");
  const { table } = await ratesInForce(pool, now());
  return ok({ board: await boardDetail(pool, row, table, ctx.user) });
});

// ---- intake ----

function readDefects(raw: unknown, length: number | null, fields: Fields): DefectZone[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 50) {
    fields.add("defects", "List at most 50 defect zones.");
    return [];
  }
  return raw.flatMap((d: unknown, i): DefectZone[] => {
    const okZone = isObject(d) && isDefectKind(d["kind"]) && isInt(d["start_mm"]) && isInt(d["end_mm"])
      && d["start_mm"] >= 0 && d["start_mm"] < d["end_mm"] && (length === null || d["end_mm"] <= length);
    if (!okZone || !isObject(d) || !isDefectKind(d["kind"]) || !isInt(d["start_mm"]) || !isInt(d["end_mm"])) {
      fields.add(`defects.${i}`, "Give a kind and a start before the end, inside the board.");
      return [];
    }
    return [{ kind: d["kind"], start_mm: d["start_mm"], end_mm: d["end_mm"] }];
  });
}

route("POST", "/api/boards", async (ctx) => {
  const user = requireUser(ctx);
  const b = isObject(ctx.body) ? ctx.body : {};
  if (typeof b["lot"] === "string" && b["lot"] !== "") {
    const lot = await one(pool, "SELECT id FROM lots WHERE id = $1", [b["lot"]]);
    if (lot === undefined) notFound();
  }
  requireRole(user, "owner", "hand");
  const fields = new Fields();
  if (typeof b["lot"] !== "string" || b["lot"] === "") fields.add("lot", "Choose a lot.");
  if (!isSpecies(b["species"])) fields.add("species", "Choose a species.");
  const length = within(b["length_mm"], LIMITS.length) ? b["length_mm"] : null;
  if (length === null) fields.add("length_mm", "Enter a length from 300 to 12000 mm.");
  if (!within(b["width_mm"], LIMITS.width)) fields.add("width_mm", "Enter a width from 20 to 600 mm.");
  if (!within(b["thickness_mm"], LIMITS.thickness)) fields.add("thickness_mm", "Enter a thickness from 10 to 400 mm.");
  const defects = readDefects(b["defects"], length, fields);
  fields.throwIfAny();
  const at = now();
  const tag = await withTransaction(async (db) => {
    const newTag = await nextTag(db);
    await db.query(
      `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects, created_at)
       VALUES ($1, $2, NULL, 'tagged', $3, $4, $5, $6, $7, $8)`,
      [newTag, b["species"], b["lot"], length, b["width_mm"], b["thickness_mm"], JSON.stringify(defects), at]);
    const volume = volumeMm3(Number(b["thickness_mm"]), Number(b["width_mm"]), length ?? 0);
    await writeMovement(db, "intake", null, user.id, [
      { account: "intake", volume_mm3: -volume }, { account: `board:${newTag}`, volume_mm3: volume }], at);
    return newTag;
  });
  const row = await boardRow(pool, tag);
  if (row === undefined) notFound();
  const { table } = await ratesInForce(pool, now());
  return ok({ board: await boardDetail(pool, row, table, user) }, 201);
});

// ---- grading, listing and lineage corrections ----

async function offcutBlocked(db: Parameters<typeof ticketStatusOf>[0], cutTicket: string | null): Promise<boolean> {
  if (cutTicket === null) return false;
  return (await ticketStatusOf(db, cutTicket)) !== "done";
}

route("POST", "/api/boards/:tag/grade", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  await visibleBoard(ctx, tag);
  requireRole(user, "owner");
  const grade = isObject(ctx.body) ? ctx.body["grade"] : undefined;
  const changed = await withTransaction(async (db) => {
    await lockLineage(db, tag);
    const board = await boardRow(db, tag, true);
    if (board === undefined) notFound();
    let affected: string[];
    if (board.status === "tagged" || board.status === "graded") {
      affected = [tag];
    } else if (board.status === "cut") {
      const below = (await descendantsInOrder(db, tag)).filter((d) => d.status === "graded" || d.status === "available");
      if (below.length === 0) throw new ApiError("board_state");
      for (const d of below) {
        const row = await boardRow(db, d.tag, true);
        if (row && (await offcutBlocked(db, row.cut_ticket))) throw new ApiError("offcut_not_cut");
      }
      affected = below.map((d) => d.tag);
    } else {
      throw new ApiError("board_state");
    }
    if (!isGrade(grade)) throw new ApiError("validation", { grade: "Choose Select, Character or Rustic." });
    for (const t of affected) {
      await db.query("UPDATE boards SET grade = $2, status = CASE WHEN status = 'tagged' THEN 'graded' ELSE status END WHERE tag = $1",
        [t, grade satisfies Grade]);
    }
    return affected;
  });
  return ok({ board: await detailFor(ctx, tag), changed });
});

async function detailFor(ctx: Context, tag: string) {
  const row = await boardRow(pool, tag);
  if (row === undefined) notFound();
  const { table } = await ratesInForce(pool, now());
  return boardDetail(pool, row, table, ctx.user);
}

route("POST", "/api/boards/:tag/list", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  await visibleBoard(ctx, tag);
  requireRole(user, "owner");
  await withTransaction(async (db) => {
    const board = await boardRow(db, tag, true);
    if (board === undefined) notFound();
    if (board.status !== "graded") throw new ApiError("board_state");
    if (await offcutBlocked(db, board.cut_ticket)) throw new ApiError("offcut_not_cut");
    await db.query("UPDATE boards SET status = 'available' WHERE tag = $1", [tag]);
  });
  return ok({ board: await detailFor(ctx, tag) });
});

route("PUT", "/api/boards/:tag/dimensions", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  await visibleBoard(ctx, tag);
  requireRole(user, "owner");
  const b = isObject(ctx.body) ? ctx.body : {};
  const lengthGiven = b["length_mm"] !== undefined;
  const changed = await withTransaction(async (db) => {
    await lockLineage(db, tag);
    const board = await boardRow(db, tag, true);
    if (board === undefined) notFound();
    if (lengthGiven && !isOpen(board.status)) throw new ApiError("board_state");
    const below = (await descendantsInOrder(db, tag)).filter((d) => isOpen(d.status));
    const affected: BoardRow[] = [];
    for (const t of [...(isOpen(board.status) ? [tag] : []), ...below.map((d) => d.tag)]) {
      const row = await boardRow(db, t, true);
      if (row) affected.push(row);
    }
    if (affected.length === 0 || affected.some((r) => r.status === "held")) throw new ApiError("board_state");
    for (const r of affected) if (await offcutBlocked(db, r.cut_ticket)) throw new ApiError("offcut_not_cut");
    const fields = new Fields();
    if (!within(b["width_mm"], LIMITS.width)) fields.add("width_mm", "Enter a width from 20 to 600 mm.");
    if (!within(b["thickness_mm"], LIMITS.thickness)) fields.add("thickness_mm", "Enter a thickness from 10 to 400 mm.");
    if (lengthGiven) {
      const furthest = Math.max(0, ...board.defects.map((d) => d.end_mm));
      if (!within(b["length_mm"], LIMITS.length) || Number(b["length_mm"]) < furthest) {
        fields.add("length_mm", "Enter a length from 300 to 12000 mm that keeps every defect zone on the board.");
      }
    }
    fields.throwIfAny();
    const width = Number(b["width_mm"]);
    const thickness = Number(b["thickness_mm"]);
    const entries = [];
    let total = 0;
    for (const r of affected) {
      const length = r.tag === tag && lengthGiven ? Number(b["length_mm"]) : r.length_mm;
      await db.query("UPDATE boards SET width_mm = $2, thickness_mm = $3, length_mm = $4 WHERE tag = $1", [r.tag, width, thickness, length]);
      const delta = volumeMm3(thickness, width, length) - (await balance(db, `board:${r.tag}`));
      if (delta !== 0) {
        entries.push({ account: `board:${r.tag}`, volume_mm3: delta });
        total += delta;
      }
    }
    if (entries.length > 0) {
      await writeMovement(db, "adjustment", null, user.id, [...entries, { account: "adjustment", volume_mm3: -total }], now());
    }
    return affected.map((r) => r.tag);
  });
  return ok({ board: await detailFor(ctx, tag), changed });
});

route("PUT", "/api/boards/:tag/parent", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  await visibleBoard(ctx, tag);
  const b = isObject(ctx.body) ? ctx.body : {};
  const parentTag = b["parent_tag"];
  if (typeof parentTag === "string" && (await boardRow(pool, parentTag)) === undefined) notFound();
  requireRole(user, "owner");
  await withTransaction(async (db) => {
    await lockLineage(db, tag);
    if (typeof parentTag === "string") await lockLineage(db, parentTag);
    const board = await boardRow(db, tag, true);
    if (board === undefined) notFound();
    if (board.cut_ticket !== null) throw new ApiError("board_state");
    if (typeof parentTag === "string") {
      const below = await descendantsInOrder(db, tag);
      if (parentTag === tag || below.some((d) => d.tag === parentTag)) throw new ApiError("lineage_cycle");
    }
    if (parentTag !== null) {
      const parent = typeof parentTag === "string" ? await boardRow(db, parentTag) : undefined;
      if (parent === undefined || parent.status !== "cut" || parent.species !== board.species) {
        throw new ApiError("validation", { parent_tag: "Choose a cut board of the same species, or null." });
      }
    }
    await db.query("UPDATE boards SET parent_tag = $2 WHERE tag = $1", [tag, parentTag]);
  });
  return ok({ board: await detailFor(ctx, tag) });
});

// ---- lineage ----

interface LineageNode {
  tag: string;
  status: BoardStatus;
  parent_tag: string | null;
  grade: Grade | null;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  volume_mm3: number;
  board_feet: string;
  rate_cents: number | null;
  price_cents: number | null;
  longest_clear_mm: number;
  created_at: string;
  children: LineageNode[];
}

route("GET", "/api/boards/:tag/lineage", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  await visibleBoard(ctx, tag);
  requireRole(user, "owner", "hand");
  const { table } = await ratesInForce(pool, now());
  const ancestors: BoardRow[] = [];
  let cursor = await boardRow(pool, tag);
  while (cursor !== undefined) {
    ancestors.unshift(cursor);
    cursor = cursor.parent_tag === null ? undefined : await boardRow(pool, cursor.parent_tag);
  }
  const below = await descendantsInOrder(pool, tag);
  const rows = new Map<string, BoardRow>();
  for (const r of await boardRows(pool, "b.tag = ANY($1)", [below.map((d) => d.tag)])) rows.set(r.tag, r);
  const node = (r: BoardRow, children: LineageNode[]): LineageNode => {
    const f = boardFigures(r, table);
    return {
      tag: r.tag, status: r.status, parent_tag: r.parent_tag, grade: r.grade, length_mm: r.length_mm, width_mm: r.width_mm,
      thickness_mm: r.thickness_mm, volume_mm3: f.volume_mm3, board_feet: f.board_feet, rate_cents: f.rate_cents,
      price_cents: f.price_cents, longest_clear_mm: f.longest_clear_mm, created_at: iso(r.created_at), children,
    };
  };
  const subtree = (parent: string): LineageNode[] =>
    below.filter((d) => d.parent_tag === parent).flatMap((d) => {
      const r = rows.get(d.tag);
      return r ? [node(r, subtree(d.tag))] : [];
    });
  let tree: LineageNode | null = null;
  for (const r of [...ancestors].reverse()) tree = node(r, tree === null ? subtree(r.tag) : [tree]);
  return ok({ board: tag, root: tree });
});

// ---- fit ----

export function readPieces(raw: unknown, fields: Fields) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    fields.add("pieces", "Give 1 to 20 pieces.");
    return [];
  }
  return raw.flatMap((p: unknown, i) => {
    const valid = isObject(p) && typeof p["label"] === "string" && [...p["label"]].length >= 1 && [...p["label"]].length <= 40
      && within(p["length_mm"], [1, 12_000]) && within(p["width_mm"], [1, 600]) && within(p["start_mm"], [0, 12_000]);
    if (!valid || !isObject(p)) {
      fields.add(`pieces.${i}`, "Each piece needs a 1–40 character label, a length of 1–12000 mm, a width of 1–600 mm and a start of 0–12000 mm.");
      return [];
    }
    return [{ label: String(p["label"]), length_mm: Number(p["length_mm"]), width_mm: Number(p["width_mm"]), start_mm: Number(p["start_mm"]) }];
  });
}

route("POST", "/api/boards/:tag/fit", async (ctx) => {
  const tag = ctx.params["tag"] ?? "";
  const row = await boardRow(pool, tag);
  if (row === undefined || (row.status !== "available" && row.status !== "held")) notFound();
  const fields = new Fields();
  const pieces = readPieces(isObject(ctx.body) ? ctx.body["pieces"] : undefined, fields);
  fields.throwIfAny();
  const { table } = await ratesInForce(pool, now());
  return ok({ board: tag, ...fitLayout(row, pieces, boardFigures(row, table).rate_cents) });
});
