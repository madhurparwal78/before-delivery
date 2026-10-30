// Carts (brief: Cart): strict lines, caps, discount codes, merge on sign-in and shared snapshots.
import { randomBytes } from "node:crypto";
import { loadCatalog, type Catalog } from "../catalog.ts";
import { transaction, type Db, type Tx } from "../db.ts";
import { ApiError, assertValid, refuseUnknown, unknownFields, type Fields } from "../errors.ts";
import { addSeconds, iso, now } from "../clock.ts";
import { CART_COOKIE, cookie, tokenHash, type Ctx } from "../http.ts";
import { roundHalfUp } from "../money.ts";
import { buildLineName, priceBuild, savedPicks, type BuildPicks } from "./builds.ts";
import { financing, type FinancingTerm } from "./financing.ts";

const CART_CAPS = { buildLine: 2, builds: 3, accessoryLine: 5 } as const;
const MAX_CODES = 2;

/** Discount codes by upper-case name: the amount each takes from the accessory subtotal before any code. */
const CODES: Record<string, (accessorySubtotal: number) => number> = {
  FLYFIRST: (subtotal) => roundHalfUp(subtotal * 10, 100),
  CHARGE25: (subtotal) => (subtotal >= 10000 ? 2500 : 0),
};

type LineType = "build" | "accessory";

export interface CartLine {
  id: number;
  type: LineType;
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

/** A priced cart line with what checkout needs beyond the public shape. */
export interface PricedLine extends CartLine {
  spares: number;
  board_name: string | null;
}

export interface Cart {
  lines: CartLine[];
  accessory_subtotal_cents: number;
  build_subtotal_cents: number;
  subtotal_cents: number;
  codes: { code: string; amount_cents: number }[];
  item_count: number;
  financing: FinancingTerm[];
}

/** A shared snapshot line (brief: Shapes). */
type SnapshotLine = Pick<CartLine, "type" | "code" | "sku" | "name" | "quantity" | "unit_cents">;

/** The cart caps for the browser's limit text, served from this one table. */
export const CART_LIMITS = CART_CAPS;

interface LineRow {
  id: number;
  type: LineType;
  build_code: string | null;
  sku: string;
  quantity: number;
}

/** Each code's amount in the order added; later codes are reduced so the total never exceeds the subtotal. */
function codeAmounts(accessorySubtotal: number, codes: string[]): { code: string; amount_cents: number }[] {
  let left = accessorySubtotal;
  return codes.map((code) => {
    const amount = Math.min(CODES[code]!(accessorySubtotal), left);
    left -= amount;
    return { code, amount_cents: amount };
  });
}

async function lineRows(db: Db, cartId: number): Promise<LineRow[]> {
  const { rows } = await db.query<LineRow>(
    "SELECT id, type, build_code, sku, quantity FROM cart_lines WHERE cart_id = $1 ORDER BY id",
    [cartId],
  );
  return rows;
}

async function priceLines(db: Db, rows: LineRow[], catalog: Catalog): Promise<PricedLine[]> {
  const lines: PricedLine[] = [];
  for (const row of rows) {
    if (row.type === "build") {
      const picks = (await savedPicks(db, row.build_code as string)) as BuildPicks;
      const build = priceBuild(picks, catalog);
      lines.push({
        id: row.id, type: "build", code: build.code, sku: build.board_sku, name: buildLineName(picks, catalog),
        quantity: row.quantity, unit_cents: build.total_cents, line_cents: build.total_cents * row.quantity,
        spares: picks.spares, board_name: build.board_name,
      });
    } else {
      const item = catalog.sellable(row.sku)!;
      lines.push({
        id: row.id, type: "accessory", code: null, sku: row.sku, name: item.name, quantity: row.quantity,
        unit_cents: item.price_cents, line_cents: item.price_cents * row.quantity, spares: 0, board_name: null,
      });
    }
  }
  return lines;
}

interface CartState {
  cart: Cart;
  lines: PricedLine[];
  codes: string[];
}

export async function cartState(db: Db, cartId: number | null, catalog?: Catalog): Promise<CartState> {
  const cat = catalog ?? (await loadCatalog(db));
  const lines = cartId === null ? [] : await priceLines(db, await lineRows(db, cartId), cat);
  const codes = cartId === null ? [] : await cartCodes(db, cartId);
  const accessory = lines.filter((l) => l.type === "accessory").reduce((s, l) => s + l.line_cents, 0);
  const builds = lines.filter((l) => l.type === "build").reduce((s, l) => s + l.line_cents, 0);
  const priced = codeAmounts(accessory, codes);
  const cart: Cart = {
    lines: lines.map(({ spares: _s, board_name: _b, ...line }) => line),
    accessory_subtotal_cents: accessory,
    build_subtotal_cents: builds,
    subtotal_cents: accessory + builds,
    codes: priced,
    item_count: lines.reduce((s, l) => s + l.quantity, 0),
    financing: financing(accessory + builds - priced.reduce((s, c) => s + c.amount_cents, 0), null),
  };
  return { cart, lines, codes };
}

async function cartCodes(db: Db, cartId: number): Promise<string[]> {
  const { rows } = await db.query<{ code: string }>("SELECT code FROM cart_codes WHERE cart_id = $1 ORDER BY position", [cartId]);
  return rows.map((r) => r.code);
}

/** The caller's cart id: the account cart when signed in, otherwise the guest cart of the cookie. */
export async function findCart(db: Db, ctx: Ctx): Promise<number | null> {
  if (ctx.user) {
    const { rows } = await db.query<{ id: number }>("SELECT id FROM carts WHERE user_id = $1", [ctx.user.id]);
    return rows[0]?.id ?? null;
  }
  const token = ctx.cookies[CART_COOKIE];
  if (!token) return null;
  const { rows } = await db.query<{ id: number }>("SELECT id FROM carts WHERE guest_token_hash = $1", [tokenHash(token)]);
  return rows[0]?.id ?? null;
}

/** Finds or creates the caller's cart and locks it for this transaction. */
async function lockedCart(tx: Tx, ctx: Ctx): Promise<number> {
  let id = await findCart(tx, ctx);
  if (id === null) {
    if (ctx.user) {
      await tx.query("INSERT INTO carts (user_id, created_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [ctx.user.id, now()]);
      id = await findCart(tx, ctx);
    } else {
      const token = randomBytes(24).toString("base64url");
      const { rows } = await tx.query<{ id: number }>(
        "INSERT INTO carts (guest_token_hash, created_at) VALUES ($1, $2) RETURNING id",
        [tokenHash(token), now()],
      );
      ctx.setCookie(cookie(CART_COOKIE, token));
      id = rows[0]!.id;
    }
  }
  await tx.query("SELECT id FROM carts WHERE id = $1 FOR UPDATE", [id]);
  return id as number;
}

export async function accountCartId(tx: Tx, userId: number): Promise<number> {
  await tx.query("INSERT INTO carts (user_id, created_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, now()]);
  const { rows } = await tx.query<{ id: number }>("SELECT id FROM carts WHERE user_id = $1 FOR UPDATE", [userId]);
  return rows[0]!.id;
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

interface Wanted {
  type: LineType;
  key: string;
  code: string | null;
  sku: string;
  quantity: number;
}

/** Refuses a cart whose lines break a cap or exceed stock; `lines` is the cart as it would be. */
function checkCaps(lines: Wanted[], catalog: Catalog, changed: Set<string>): void {
  for (const line of lines.filter((l) => changed.has(l.key))) {
    const cap = line.type === "build" ? CART_CAPS.buildLine : CART_CAPS.accessoryLine;
    if (line.quantity > cap) throw new ApiError("limit", { message: `Limit ${cap} per order.` });
  }
  const builds = lines.filter((l) => l.type === "build").reduce((s, l) => s + l.quantity, 0);
  if (builds > CART_CAPS.builds && lines.some((l) => l.type === "build" && changed.has(l.key))) {
    throw new ApiError("limit", { message: `Limit ${CART_CAPS.builds} per order.` });
  }
  for (const line of lines.filter((l) => changed.has(l.key))) {
    if (line.quantity > catalog.stock(line.sku)) {
      throw new ApiError("out_of_stock", { status: 422, message: `Not enough stock for ${line.sku}.` });
    }
  }
}

async function wantedLines(tx: Tx, cartId: number): Promise<Wanted[]> {
  return (await lineRows(tx, cartId)).map((r) => ({
    type: r.type, key: r.build_code ?? r.sku, code: r.build_code, sku: r.sku, quantity: r.quantity,
  }));
}

async function writeLines(tx: Tx, cartId: number, lines: Wanted[]): Promise<void> {
  for (const line of lines) {
    if (line.quantity === 0) await tx.query("DELETE FROM cart_lines WHERE cart_id = $1 AND line_key = $2", [cartId, line.key]);
    else {
      await tx.query(
        `INSERT INTO cart_lines (cart_id, type, line_key, build_code, sku, quantity) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cart_id, line_key) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [cartId, line.type, line.key, line.code, line.sku, line.quantity],
      );
    }
  }
}

/** Adds `adds` to the cart, all or nothing, under the caps and stock. */
async function addLines(tx: Tx, cartId: number, adds: Omit<Wanted, "key">[], catalog: Catalog): Promise<void> {
  const lines = await wantedLines(tx, cartId);
  const changed = new Set<string>();
  for (const add of adds) {
    const key = add.code ?? add.sku;
    const existing = lines.find((l) => l.key === key);
    if (existing) existing.quantity += add.quantity;
    else lines.push({ ...add, key });
    changed.add(key);
  }
  checkCaps(lines, catalog, changed);
  await writeLines(tx, cartId, lines.filter((l) => changed.has(l.key)));
}

async function parseLine(db: Db, body: Record<string, unknown>, catalog: Catalog): Promise<Omit<Wanted, "key">> {
  const type = body.type;
  const allowed = type === "build" ? ["type", "quantity", "code"] : type === "accessory" ? ["type", "quantity", "sku"] : ["type", "quantity", "code", "sku"];
  const unknown = refuseUnknown(body, allowed);
  if (Object.keys(unknown).length) throw unknownFields(unknown);
  const fields: Fields = {};
  if (type !== "build" && type !== "accessory") fields.type = "Choose build or accessory.";
  const quantity = body.quantity ?? 1;
  if (!isCount(quantity, 1)) fields.quantity = "Enter a whole number of at least 1.";
  let sku = "";
  let code: string | null = null;
  if (type === "build") {
    const picks = typeof body.code === "string" ? await savedPicks(db, body.code) : null;
    if (picks) {
      code = body.code as string;
      sku = picks.board_sku;
    } else fields.code = "Choose a saved build.";
  } else if (type === "accessory") {
    if (typeof body.sku === "string" && catalog.sellable(body.sku)) sku = body.sku;
    else fields.sku = "Choose a product we sell.";
  }
  assertValid(fields);
  return { type: type as LineType, code, sku, quantity: quantity as number };
}

async function lineOf(tx: Tx, cartId: number | null, id: string): Promise<LineRow> {
  const row = /^\d{1,9}$/.test(id) && cartId !== null
    ? (await tx.query<LineRow>("SELECT id, type, build_code, sku, quantity FROM cart_lines WHERE id = $1 AND cart_id = $2", [id, cartId])).rows[0]
    : undefined;
  if (!row) throw new ApiError("not_found");
  return row;
}

export async function readCart(db: Db, ctx: Ctx): Promise<Cart> {
  return (await cartState(db, await findCart(db, ctx))).cart;
}

export async function addLine(ctx: Ctx): Promise<Cart> {
  return transaction(async (tx) => {
    const catalog = await loadCatalog(tx);
    const add = await parseLine(tx, ctx.body, catalog);
    const cartId = await lockedCart(tx, ctx);
    await addLines(tx, cartId, [add], catalog);
    return (await cartState(tx, cartId, catalog)).cart;
  });
}

export async function updateLine(ctx: Ctx, id: string): Promise<Cart> {
  return transaction(async (tx) => {
    const cartId = await findCart(tx, ctx);
    const row = await lineOf(tx, cartId, id);
    await tx.query("SELECT id FROM carts WHERE id = $1 FOR UPDATE", [cartId]);
    if (!isCount(ctx.body.quantity, 0)) throw new ApiError("validation_error", { fields: { quantity: "Enter a whole number of 0 or more." } });
    const catalog = await loadCatalog(tx);
    const lines = await wantedLines(tx, cartId as number);
    const key = row.build_code ?? row.sku;
    const line = lines.find((l) => l.key === key) as Wanted;
    line.quantity = ctx.body.quantity;
    if (line.quantity > 0) checkCaps(lines, catalog, new Set([key]));
    await writeLines(tx, cartId as number, [line]);
    return (await cartState(tx, cartId, catalog)).cart;
  });
}

export async function removeLine(ctx: Ctx, id: string): Promise<Cart> {
  return transaction(async (tx) => {
    const cartId = await findCart(tx, ctx);
    const row = await lineOf(tx, cartId, id);
    await tx.query("DELETE FROM cart_lines WHERE id = $1", [row.id]);
    return (await cartState(tx, cartId)).cart;
  });
}

export async function applyCode(ctx: Ctx): Promise<Cart> {
  return transaction(async (tx) => {
    const raw = ctx.body.code;
    if (typeof raw !== "string" || raw.trim() === "") throw new ApiError("validation_error", { fields: { code: "Enter a code." } });
    const code = raw.trim().toUpperCase();
    if (!CODES[code]) throw new ApiError("invalid_code");
    const cartId = await lockedCart(tx, ctx);
    const codes = await cartCodes(tx, cartId);
    if (codes.includes(code)) throw new ApiError("code_already_applied");
    if (codes.length >= MAX_CODES) throw new ApiError("too_many_codes");
    await tx.query("INSERT INTO cart_codes (cart_id, code) VALUES ($1, $2)", [cartId, code]);
    return (await cartState(tx, cartId)).cart;
  });
}

export async function removeCode(ctx: Ctx, code: string): Promise<Cart> {
  return transaction(async (tx) => {
    const cartId = await findCart(tx, ctx);
    const { rowCount } = await tx.query("DELETE FROM cart_codes WHERE cart_id = $1 AND code = $2", [cartId, code.toUpperCase()]);
    if (!rowCount) throw new ApiError("not_found");
    return (await cartState(tx, cartId)).cart;
  });
}

const SHARE_SECONDS = 2_592_000;
/** Headers on the shared cart read and page (brief: Cart, Sharing). */
export const SHARE_HEADERS = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** Freezes the current lines under a new 144-bit token. */
export async function shareCart(db: Db, ctx: Ctx): Promise<{ token: string; expires_at: string }> {
  const { cart } = await cartState(db, await findCart(db, ctx));
  const token = randomBytes(18).toString("base64url");
  const lines: SnapshotLine[] = cart.lines.map(({ type, code, sku, name, quantity, unit_cents }) => ({ type, code, sku, name, quantity, unit_cents }));
  const expires = addSeconds(now(), SHARE_SECONDS);
  await db.query("INSERT INTO cart_shares (token, lines, created_at) VALUES ($1, $2, $3)", [token, JSON.stringify(lines), now()]);
  return { token, expires_at: iso(expires) };
}

/** The snapshot while now < expires_at; otherwise, or for an unknown token, the same 404. */
export async function sharedSnapshot(db: Db, token: string): Promise<{ lines: SnapshotLine[]; expires_at: string }> {
  const { rows } = await db.query<{ lines: SnapshotLine[]; created_at: Date }>("SELECT lines, created_at FROM cart_shares WHERE token = $1", [token]);
  const row = rows[0];
  const expires = row ? addSeconds(row.created_at, SHARE_SECONDS) : null;
  if (!row || !expires || now() >= expires) throw new ApiError("not_found", { headers: SHARE_HEADERS });
  return {
    lines: row.lines.map(({ type, code, sku, name, quantity, unit_cents }) => ({ type, code, sku, name, quantity, unit_cents })),
    expires_at: iso(expires),
  };
}

export async function importShared(ctx: Ctx, token: string): Promise<Cart> {
  return transaction(async (tx) => {
    const { lines } = await sharedSnapshot(tx, token);
    const catalog = await loadCatalog(tx);
    const cartId = await lockedCart(tx, ctx);
    await addLines(tx, cartId, lines.map((l) => ({ type: l.type, code: l.code, sku: l.sku, quantity: l.quantity })), catalog);
    return (await cartState(tx, cartId, catalog)).cart;
  });
}

/**
 * Merge on sign-in: same code or SKU lines add, each line is clamped to its cap, build lines over the total cap
 * lose guest quantities newest guest line first, guest codes join while there is room, the guest cart empties.
 */
export async function mergeGuestCart(tx: Tx, ctx: Ctx, userId: number): Promise<void> {
  const token = ctx.cookies[CART_COOKIE];
  if (!token) return;
  const guest = (await tx.query<{ id: number }>("SELECT id FROM carts WHERE guest_token_hash = $1 FOR UPDATE", [tokenHash(token)])).rows[0];
  if (!guest) return;
  const guestLines = await wantedLines(tx, guest.id);
  const guestCodes = await cartCodes(tx, guest.id);
  if (!guestLines.length && !guestCodes.length) return;
  const cartId = await accountCartId(tx, userId);
  const lines = await wantedLines(tx, cartId);
  const fromGuest = new Map<string, number>();
  for (const g of guestLines) {
    const existing = lines.find((l) => l.key === g.key);
    if (existing) existing.quantity += g.quantity;
    else lines.push({ ...g });
    fromGuest.set(g.key, g.quantity);
  }
  for (const line of lines) {
    const cap = line.type === "build" ? CART_CAPS.buildLine : CART_CAPS.accessoryLine;
    if (line.quantity > cap) {
      const cut = line.quantity - cap;
      line.quantity = cap;
      fromGuest.set(line.key, Math.max(0, (fromGuest.get(line.key) ?? 0) - cut));
    }
  }
  let excess = lines.filter((l) => l.type === "build").reduce((s, l) => s + l.quantity, 0) - CART_CAPS.builds;
  for (const g of [...guestLines].reverse()) {
    if (excess <= 0) break;
    const line = lines.find((l) => l.key === g.key && l.type === "build");
    if (!line) continue;
    const cut = Math.min(excess, fromGuest.get(g.key) ?? 0);
    line.quantity -= cut;
    excess -= cut;
  }
  await writeLines(tx, cartId, lines);
  const accountCodes = await cartCodes(tx, cartId);
  for (const code of guestCodes) {
    if (accountCodes.length >= MAX_CODES || accountCodes.includes(code)) continue;
    await tx.query("INSERT INTO cart_codes (cart_id, code) VALUES ($1, $2)", [cartId, code]);
    accountCodes.push(code);
  }
  await tx.query("DELETE FROM cart_lines WHERE cart_id = $1", [guest.id]);
  await tx.query("DELETE FROM cart_codes WHERE cart_id = $1", [guest.id]);
}
