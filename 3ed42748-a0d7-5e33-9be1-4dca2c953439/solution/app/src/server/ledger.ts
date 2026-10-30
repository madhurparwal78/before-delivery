// The stamp ledger: paired movements, balances and stamp history pages with cursors bound to
// the courier who received them.
import { createHmac, timingSafeEqual } from "node:crypto";
import { all, one, type Db } from "./db";
import { validation } from "./errors";
import { iso, randomId } from "./ids";

/** SQL condition for "this movement belongs to the courier", including guest saves merged into them. */
const ownedBy = (alias: string, param: string): string =>
  `(${alias}.courier_id = ${param} OR ${alias}.courier_id IN (SELECT id FROM couriers WHERE merged_into = ${param}))`;

export async function balanceOf(db: Db, courierId: string): Promise<number> {
  const row = await one<{ balance: number }>(
    db,
    `SELECT COALESCE(SUM(e.amount), 0)::int AS balance
       FROM movements m JOIN ledger_entries e ON e.movement_id = m.id
      WHERE e.account = 'courier' AND ${ownedBy("m", "$1")}`,
    [courierId],
  );
  return row!.balance;
}

type MovementKind = "delivery" | "purchase";

/** Writes one movement as two entries that sum to zero. `amount` is the courier side. */
export async function writeMovement(
  db: Db,
  courierId: string,
  kind: MovementKind,
  ref: string,
  amount: number,
): Promise<string> {
  const id = randomId("mv_");
  await db.query("INSERT INTO movements (id, courier_id, kind, created_at) VALUES ($1, $2, $3, $4)", [
    id,
    courierId,
    kind,
    new Date(),
  ]);
  const counter = kind === "delivery" ? "mint" : "outfitter";
  await db.query(
    "INSERT INTO ledger_entries (movement_id, account, amount, ref) VALUES ($1, 'courier', $2, $4), ($1, $3, $5, $4)",
    [id, amount, counter, ref, -amount],
  );
  return id;
}

let cursorSecret: string | null = null;

async function secret(db: Db): Promise<string> {
  cursorSecret ??= (await one<{ cursor_secret: string }>(db, "SELECT cursor_secret FROM app_settings WHERE id = 1"))!
    .cursor_secret;
  return cursorSecret;
}

function sign(key: string, courierId: string, payload: string): string {
  return createHmac("sha256", key).update(`${courierId}|${payload}`).digest("hex");
}

interface CursorPoint {
  at: number;
  id: string;
}

async function encodeCursor(db: Db, courierId: string, point: CursorPoint): Promise<string> {
  const payload = Buffer.from(JSON.stringify([point.at, point.id])).toString("base64url");
  return `${payload}.${sign(await secret(db), courierId, payload)}`;
}

async function decodeCursor(db: Db, courierId: string, cursor: string): Promise<CursorPoint | null> {
  const dot = cursor.lastIndexOf(".");
  const payload = cursor.slice(0, dot);
  const mac = cursor.slice(dot + 1);
  if (dot < 1 || !/^[0-9a-f]{64}$/.test(mac) || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const expected = sign(await secret(db), courierId, payload);
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "string")
      return { at: value[0], id: value[1] };
  } catch {
    return null;
  }
  return null;
}

interface HistoryQuery {
  limit: string | null;
  before: string | null;
}

export async function historyPage(db: Db, courierId: string, query: HistoryQuery): Promise<object> {
  let limit = 20;
  if (query.limit !== null) {
    if (!/^-?\d+$/.test(query.limit.trim())) throw validation({ limit: "invalid" });
    limit = Number(query.limit);
    if (limit < 1 || limit > 50) throw validation({ limit: "out_of_range" });
  }
  let point: CursorPoint | null = null;
  if (query.before !== null) {
    point = await decodeCursor(db, courierId, query.before);
    if (!point) throw validation({ before: "invalid" });
  }
  const params: unknown[] = [courierId, limit + 1];
  let older = "";
  if (point) {
    params.push(new Date(point.at), point.id);
    older = "AND (m.created_at, m.id) < ($3, $4)";
  }
  const rows = await all<{ id: string; kind: string; created_at: Date }>(
    db,
    `SELECT m.id, m.kind, m.created_at FROM movements m
      WHERE ${ownedBy("m", "$1")} ${older}
      ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
    params,
  );
  const pageRows = rows.slice(0, limit);
  const entries = await all<{ movement_id: string; account: string; amount: number; ref: string }>(
    db,
    `SELECT movement_id, account, amount, ref FROM ledger_entries
      WHERE movement_id = ANY($1) ORDER BY (account = 'courier') DESC, id`,
    [pageRows.map((r) => r.id)],
  );
  const last = pageRows.at(-1);
  return {
    balance: await balanceOf(db, courierId),
    movements: pageRows.map((r) => ({
      movement_id: r.id,
      kind: r.kind,
      created_at: iso(r.created_at),
      entries: entries
        .filter((e) => e.movement_id === r.id)
        .map((e) => ({ account: e.account, amount: e.amount, ref: e.ref })),
    })),
    next_cursor:
      rows.length > limit && last ? await encodeCursor(db, courierId, { at: last.created_at.getTime(), id: last.id }) : null,
  };
}
