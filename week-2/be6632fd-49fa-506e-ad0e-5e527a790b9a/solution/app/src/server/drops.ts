// Drops for staff (brief: API → Drops; Business rules → Drop states, Simultaneous and Rolling go-live).
import { COPY, FIELD, gapMessage } from "../shared/copy";
import { dateText } from "../shared/format";
import {
  type DropType,
  MARKETS,
  type Market,
  copenhagenWall,
  instantText,
  localText,
  parseInstant,
  parseLocal,
  rollingOpenings,
  simultaneousInstant,
} from "../shared/time";
import { type Member, requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { ApiError, type Json, notFound, reply, route, validationFailed } from "./http";
import { type MarketState, marketStates, marketStatesOf } from "./pieces";
import { type Fields, failed, isUuid, optionalText, requiredText, wholeNumber } from "./validate";

const SWATCHES = ["stone", "ink", "vermilion", "night", "moss", "sand", "rust", "fog"] as const;

export type DropStatus = "draft" | "scheduled" | "live" | "sold_out" | "withdrawn";

export interface DropRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  type: DropType;
  status: DropStatus;
  hold_seconds: number;
  palette: string[];
  internal_note: string;
  copenhagen_go_live: string | null;
  local_go_live: string | null;
  created_at: Date;
  withdrawn_at: Date | null;
  look_order_version: number;
  look_saved_by: string | null;
  look_saved_at: Date | null;
}

export interface StyleRow {
  id: string;
  style_number: string;
  name: string;
  colour: string;
  wholesale_edition: number;
  rrp_dkk_minor: number;
}

/** The legal edges of the drop state machine; every status change goes through here. */
const EDGES: Record<DropStatus, DropStatus[]> = {
  draft: ["scheduled"],
  scheduled: ["live", "withdrawn"],
  live: ["sold_out", "withdrawn"],
  sold_out: ["live", "withdrawn"],
  withdrawn: [],
};

function canMove(from: DropStatus, to: DropStatus): boolean {
  return EDGES[from].includes(to);
}

export async function moveDrop(db: Db, drop: Pick<DropRow, "id" | "status">, to: DropStatus): Promise<void> {
  if (!canMove(drop.status, to)) {
    if (to === "scheduled") throw new ApiError(409, "drop_not_draft", COPY.dropNotDraft);
    if (to === "withdrawn") {
      throw drop.status === "draft"
        ? new ApiError(409, "drop_not_public", COPY.dropNotPublic)
        : new ApiError(409, "drop_withdrawn_already", COPY.dropWithdrawnAlready);
    }
    throw new ApiError(409, "drop_locked", COPY.dropLocked);
  }
  await db.query("UPDATE drops SET status = $2, withdrawn_at = CASE WHEN $2 = 'withdrawn' THEN $3 ELSE withdrawn_at END WHERE id = $1", [
    drop.id,
    to,
    nowSeconds(),
  ]);
}

/** Live while a market has pieces or claims to make; sold out once every market's claims equal its store pieces. */
export async function settleSales(db: Db, dropId: string): Promise<void> {
  const drop = await one<Pick<DropRow, "id" | "status">>(db, "SELECT id, status FROM drops WHERE id = $1 FOR UPDATE", [dropId]);
  if (!drop || (drop.status !== "live" && drop.status !== "sold_out")) return;
  const markets = await marketStatesOf(db, dropId);
  const soldOut = markets.every((m) => m.claimed >= m.storePieces);
  if (soldOut && drop.status === "live") await moveDrop(db, drop, "sold_out");
  if (!soldOut && drop.status === "sold_out") await moveDrop(db, drop, "live");
}

function isPublic(status: DropStatus): boolean {
  return status === "scheduled" || status === "live" || status === "sold_out";
}

export async function stylesOf(db: Db, dropId: string): Promise<StyleRow[]> {
  return rows<StyleRow>(db, "SELECT id, style_number, name, colour, wholesale_edition, rrp_dkk_minor FROM styles WHERE drop_id = $1 ORDER BY position", [dropId]);
}

/** A drop of the caller's workspace (step 5); a stockist buyer only sees scheduled, live and sold-out drops. */
export async function staffDrop(db: Db, me: Member, id: string, lock = false): Promise<DropRow> {
  const drop = isUuid(id)
    ? await one<DropRow>(db, `SELECT * FROM drops WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`, [id, me.workspaceId])
    : undefined;
  if (!drop || (me.role === "stockist_buyer" && !isPublic(drop.status))) throw notFound();
  return drop;
}

function staffJson(drop: DropRow, markets: MarketState[], styles: StyleRow[]): Json {
  const instants = markets.map((m) => m.goLiveMs).filter((ms): ms is number => ms !== null);
  return {
    id: drop.id,
    slug: drop.slug,
    name: drop.name,
    type: drop.type,
    status: drop.status,
    holdSeconds: drop.hold_seconds,
    palette: drop.palette,
    internalNote: drop.internal_note,
    goLiveAt: instants.length ? instantText(Math.min(...instants)) : null,
    copenhagenGoLive: drop.copenhagen_go_live,
    localGoLive: drop.local_go_live,
    markets: markets.map((m) => ({
      market: m.market,
      city: m.city,
      goLiveAt: m.goLiveAt,
      storePieces: m.storePieces,
      claimed: m.claimed,
      held: m.held,
      piecesLeft: m.piecesLeft,
      status: m.status,
    })),
    styles: styles.map((s) => ({ styleNumber: s.style_number, name: s.name, colour: s.colour, wholesaleEdition: s.wholesale_edition, rrpDkkMinor: s.rrp_dkk_minor })),
    createdAt: instantText(drop.created_at.getTime()),
    withdrawnAt: drop.withdrawn_at ? instantText(drop.withdrawn_at.getTime()) : null,
  };
}

function buyerJson(drop: DropRow, styles: StyleRow[]): Json {
  return { id: drop.id, name: drop.name, status: drop.status, styles: styles.map((s) => ({ styleNumber: s.style_number, name: s.name, colour: s.colour })) };
}

async function dropJson(db: Db, me: Member, drop: DropRow): Promise<Json> {
  const styles = await stylesOf(db, drop.id);
  if (me.role === "stockist_buyer") return buyerJson(drop, styles);
  return staffJson(drop, await marketStatesOf(db, drop.id), styles);
}

// ---- input ----

interface Timing {
  type: DropType;
  copenhagenGoLive: string | null;
  localGoLive: string | null;
  openings: Map<Market, number> | null;
}

/** Go-live instant resolution for the timing fields of a request; writes field errors into `fields`. */
function resolveTiming(body: Record<string, unknown>, type: DropType, fields: Fields, nowMs: number): Timing {
  const none: Timing = { type, copenhagenGoLive: null, localGoLive: null, openings: null };
  if (type === "simultaneous") {
    const hasInstant = body.goLiveAt !== undefined && body.goLiveAt !== null;
    const hasLocal = body.copenhagenGoLive !== undefined && body.copenhagenGoLive !== null;
    if (hasInstant && hasLocal) {
      fields.goLiveAt = "Give either goLiveAt or copenhagenGoLive, not both.";
      return none;
    }
    let ms: number | null = null;
    if (hasInstant) {
      ms = typeof body.goLiveAt === "string" ? parseInstant(body.goLiveAt) : null;
      if (ms === null) {
        fields.goLiveAt = FIELD.instant;
        return none;
      }
    } else if (hasLocal) {
      const wall = typeof body.copenhagenGoLive === "string" ? parseLocal(body.copenhagenGoLive) : null;
      if (!wall) {
        fields.copenhagenGoLive = "Enter a date and time like 2027-03-18T10:00.";
        return none;
      }
      ms = simultaneousInstant(wall);
      if (ms === null) {
        fields.copenhagenGoLive = gapMessage(dateText(wall));
        return none;
      }
    } else return none;
    if (ms <= nowMs) {
      fields[hasInstant ? "goLiveAt" : "copenhagenGoLive"] = FIELD.notLater;
      return none;
    }
    const at = ms;
    return { type, copenhagenGoLive: localText(copenhagenWall(at)), localGoLive: null, openings: new Map(MARKETS.map((m) => [m, at])) };
  }
  if (body.localGoLive === undefined || body.localGoLive === null) return none;
  const wall = typeof body.localGoLive === "string" ? parseLocal(body.localGoLive) : null;
  if (!wall) {
    fields.localGoLive = "Enter a date and time like 2027-03-18T10:00.";
    return none;
  }
  const openings = rollingOpenings(wall);
  if (Math.min(...openings.map((o) => o.ms)) <= nowMs) {
    fields.localGoLive = FIELD.notLater;
    return none;
  }
  return { type, copenhagenGoLive: null, localGoLive: localText(wall), openings: new Map(openings.map((o) => [o.market, o.ms])) };
}

export function checkPieces(value: unknown, path: string, fields: Fields): Record<Market, number> {
  const pieces = Object.fromEntries(MARKETS.map((m) => [m, 0])) as Record<Market, number>;
  if (value === undefined || value === null) {
    fields[path] = FIELD.required;
    return pieces;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    fields[path] = "Give pieces for all six markets.";
    return pieces;
  }
  const given = value as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!(MARKETS as readonly string[]).includes(key)) fields[`${path}.${key}`] = FIELD.market;
  for (const market of MARKETS) pieces[market] = wholeNumber(given[market], `${path}.${market}`, 0, 100_000, fields);
  return pieces;
}

interface StyleInput {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
  rrpDkkMinor: number;
}

function checkStyles(value: unknown, fields: Fields): StyleInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    fields.styles = FIELD.required;
    return [];
  }
  if (value.length > 50) {
    fields.styles = "Add at most 50 styles.";
    return [];
  }
  const seen = new Set<string>();
  return value.map((raw, i) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const styleNumber = requiredText(s.styleNumber, `styles.${i}.styleNumber`, 40, fields);
    if (styleNumber && seen.has(styleNumber.toLowerCase())) fields[`styles.${i}.styleNumber`] = "Use a different style number for each style.";
    seen.add(styleNumber.toLowerCase());
    return {
      styleNumber,
      name: requiredText(s.name, `styles.${i}.name`, 80, fields),
      colour: requiredText(s.colour, `styles.${i}.colour`, 40, fields),
      wholesaleEdition: wholeNumber(s.wholesaleEdition, `styles.${i}.wholesaleEdition`, 0, 100_000, fields),
      rrpDkkMinor: s.rrpDkkMinor === undefined ? 0 : wholeNumber(s.rrpDkkMinor, `styles.${i}.rrpDkkMinor`, 0, 100_000_000, fields),
    };
  });
}

function checkPalette(value: unknown, fields: Fields): string[] {
  if (value === undefined) return ["ink", "vermilion", "sand"];
  if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => (SWATCHES as readonly unknown[]).includes(v))) {
    fields.palette = `Choose three of ${SWATCHES.join(", ")}.`;
    return ["ink", "vermilion", "sand"];
  }
  return value as string[];
}

function checkType(value: unknown, fields: Fields): DropType {
  if (value === undefined) return "simultaneous";
  if (value !== "simultaneous" && value !== "rolling") fields.type = "Choose Simultaneous or Rolling.";
  return value === "rolling" ? "rolling" : "simultaneous";
}

function checkHold(value: unknown, fields: Fields): number {
  return value === undefined ? 900 : wholeNumber(value, "holdSeconds", 10, 86_400, fields);
}

interface NewDrop {
  name: string;
  type: DropType;
  status: "draft" | "scheduled";
  holdSeconds: number;
  palette: string[];
  internalNote: string;
  pieces: Record<Market, number>;
  styles: StyleInput[];
  timing: Timing;
}

/** Checks the fields of a new drop; with `partial`, only the fields that were sent (the New drop steps). */
function checkNewDrop(body: Record<string, unknown>, partial: boolean, fields: Fields): NewDrop {
  const has = (key: string): boolean => !partial || key in body;
  const type = checkType(body.type, fields);
  const status = body.status === undefined ? "draft" : body.status;
  if (status !== "draft" && status !== "scheduled") fields.status = "Choose draft or scheduled.";
  const timing = resolveTiming(body, type, fields, Date.now());
  if (status === "scheduled" && !timing.openings && !failed(fields)) fields[type === "rolling" ? "localGoLive" : "copenhagenGoLive"] = FIELD.required;
  return {
    name: has("name") ? requiredText(body.name, "name", 120, fields) : "",
    type,
    status: status === "scheduled" ? "scheduled" : "draft",
    holdSeconds: checkHold(body.holdSeconds, fields),
    palette: checkPalette(body.palette, fields),
    internalNote: optionalText(body.internalNote, "internalNote", 2000, fields),
    pieces: has("markets") ? checkPieces(body.markets, "markets", fields) : checkPieces({}, "markets", {}),
    styles: has("styles") ? checkStyles(body.styles, fields) : [],
    timing,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "drop";
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set((await rows<{ slug: string }>(db, "SELECT slug FROM drops WHERE slug = $1 OR slug LIKE $2", [base, `${base}-%`])).map((r) => r.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

async function writeOpenings(db: Db, dropId: string, openings: Map<Market, number> | null): Promise<void> {
  for (const market of MARKETS) {
    const ms = openings?.get(market);
    await db.query("UPDATE drop_markets SET go_live_at = $3 WHERE drop_id = $1 AND market = $2", [dropId, market, ms === undefined ? null : new Date(ms)]);
  }
}

route("GET", "/api/drops", "none", async (ctx) => {
  const me = await staff(ctx);
  const drops = await rows<DropRow>(pool, "SELECT * FROM drops WHERE workspace_id = $1 ORDER BY created_at DESC, name", [me.workspaceId]);
  const visible = me.role === "stockist_buyer" ? drops.filter((d) => isPublic(d.status)) : drops;
  const states = await marketStates(pool, visible.map((d) => d.id));
  const items: Json[] = [];
  for (const drop of visible) {
    const styles = await stylesOf(pool, drop.id);
    items.push(me.role === "stockist_buyer" ? buyerJson(drop, styles) : staffJson(drop, states.get(drop.id) ?? [], styles));
  }
  return reply(200, { items });
});

route("GET", "/api/drops/{dropId}", "none", async (ctx) => {
  const me = await staff(ctx);
  return reply(200, await dropJson(pool, me, await staffDrop(pool, me, ctx.params.dropId)));
});

route("POST", "/api/drops/checks", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "launch_producer");
  const fields: Fields = {};
  checkNewDrop(ctx.json(), true, fields);
  if (failed(fields)) throw validationFailed(fields);
  return reply(204);
});

route("POST", "/api/drops", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "launch_producer");
  const fields: Fields = {};
  const input = checkNewDrop(ctx.json(), false, fields);
  if (failed(fields)) throw validationFailed(fields);
  return tx(async (db) => {
    const created = await one<DropRow>(
      db,
      `INSERT INTO drops (workspace_id, slug, name, type, status, hold_seconds, palette, internal_note, copenhagen_go_live, local_go_live, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [me.workspaceId, await uniqueSlug(db, input.name), input.name, input.type, input.status, input.holdSeconds, input.palette, input.internalNote,
        input.timing.copenhagenGoLive, input.timing.localGoLive, nowSeconds()],
    );
    const drop = created as DropRow;
    for (const market of MARKETS) {
      await db.query("INSERT INTO drop_markets (drop_id, market, store_pieces, go_live_at) VALUES ($1, $2, $3, $4)", [
        drop.id, market, input.pieces[market], input.timing.openings ? new Date(input.timing.openings.get(market) ?? 0) : null,
      ]);
    }
    for (const [i, s] of input.styles.entries()) {
      await db.query("INSERT INTO styles (drop_id, position, style_number, name, colour, wholesale_edition, rrp_dkk_minor) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        drop.id, i + 1, s.styleNumber, s.name, s.colour, s.wholesaleEdition, s.rrpDkkMinor,
      ]);
    }
    await db.query("INSERT INTO stories (drop_id, html, version) VALUES ($1, '', 1)", [drop.id]);
    return reply(201, await dropJson(db, me, drop));
  });
});

route("PATCH", "/api/drops/{dropId}", "json", async (ctx) => {
  const me = await staff(ctx);
  await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  return tx(async (db) => {
    const drop = await staffDrop(db, me, ctx.params.dropId, true);
    if (drop.status !== "draft" && drop.status !== "scheduled") throw new ApiError(409, "drop_locked", COPY.dropLocked);
    const fields: Fields = {};
    const name = "name" in body ? requiredText(body.name, "name", 120, fields) : drop.name;
    const type = "type" in body ? checkType(body.type, fields) : drop.type;
    const hold = "holdSeconds" in body ? wholeNumber(body.holdSeconds, "holdSeconds", 10, 86_400, fields) : drop.hold_seconds;
    const palette = "palette" in body ? checkPalette(body.palette, fields) : drop.palette;
    const note = "internalNote" in body ? optionalText(body.internalNote, "internalNote", 2000, fields) : drop.internal_note;
    const pieces = "markets" in body ? checkPieces(body.markets, "markets", fields) : null;
    const timingSent = ["goLiveAt", "copenhagenGoLive", "localGoLive"].some((k) => k in body);
    const timing = timingSent ? resolveTiming(body, type, fields, Date.now()) : null;
    if (drop.status === "scheduled" && ((timingSent && !timing?.openings) || (!timingSent && type !== drop.type)) && !failed(fields)) {
      fields[type === "rolling" ? "localGoLive" : "copenhagenGoLive"] = FIELD.required;
    }
    if (failed(fields)) throw validationFailed(fields);
    await db.query("UPDATE drops SET name = $2, type = $3, hold_seconds = $4, palette = $5, internal_note = $6 WHERE id = $1", [drop.id, name, type, hold, palette, note]);
    if (timing || type !== drop.type) {
      await db.query("UPDATE drops SET copenhagen_go_live = $2, local_go_live = $3 WHERE id = $1", [drop.id, timing?.copenhagenGoLive ?? null, timing?.localGoLive ?? null]);
      await writeOpenings(db, drop.id, timing?.openings ?? null);
    }
    if (pieces) {
      for (const market of MARKETS) await db.query("UPDATE drop_markets SET store_pieces = $3 WHERE drop_id = $1 AND market = $2", [drop.id, market, pieces[market]]);
    }
    return reply(200, await dropJson(db, me, await staffDrop(db, me, drop.id)));
  });
});

route("POST", "/api/drops/{dropId}/schedule", "none", async (ctx) => {
  const me = await staff(ctx);
  await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer");
  return tx(async (db) => {
    const drop = await staffDrop(db, me, ctx.params.dropId, true);
    if (!canMove(drop.status, "scheduled")) await moveDrop(db, drop, "scheduled");
    const markets = await marketStatesOf(db, drop.id);
    const first = Math.min(...markets.map((m) => m.goLiveMs ?? Number.POSITIVE_INFINITY));
    const field = drop.type === "rolling" ? "localGoLive" : "copenhagenGoLive";
    if (!Number.isFinite(first)) throw validationFailed({ [field]: FIELD.required });
    if (first <= Date.now()) throw validationFailed({ [field]: FIELD.notLater });
    await moveDrop(db, drop, "scheduled");
    return reply(200, await dropJson(db, me, await staffDrop(db, me, drop.id)));
  });
});

route("POST", "/api/drops/{dropId}/withdraw", "json", async (ctx) => {
  const me = await staff(ctx);
  await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  return tx(async (db) => {
    const drop = await staffDrop(db, me, ctx.params.dropId, true);
    if (!canMove(drop.status, "withdrawn")) await moveDrop(db, drop, "withdrawn");
    const fields: Fields = {};
    const reason = optionalText(body.reason, "reason", 200, fields);
    if (failed(fields)) throw validationFailed(fields);
    await moveDrop(db, drop, "withdrawn");
    await db.query("UPDATE drops SET withdraw_reason = $2 WHERE id = $1", [drop.id, reason]);
    await db.query("UPDATE holds SET status = 'void' WHERE drop_id = $1 AND status = 'offered'", [drop.id]);
    return reply(200, await dropJson(db, me, await staffDrop(db, me, drop.id)));
  });
});

