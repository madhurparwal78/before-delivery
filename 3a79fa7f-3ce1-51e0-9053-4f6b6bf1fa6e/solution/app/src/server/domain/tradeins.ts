// Trade-ins (brief: Trade-ins): the transition table, expiry on read and the single open trade-in rule.
import { transaction, type Db } from "../db.ts";
import { ApiError, assertValid, invalid, type Fields } from "../errors.ts";
import { addSeconds, iso, now, SECONDS } from "../clock.ts";
import type { User } from "../http.ts";
import { tradeInQuoted } from "./notices.ts";

export const TRADE_IN_BRANDS = ["Tern Foils", "Other electric hydrofoil", "Surf foil board"] as const;
type Status = "submitted" | "quoted" | "accepted" | "expired" | "rejected" | "applied";

/** Moves a person may make; any other move is an illegal transition. The system moves accepted ↔ applied. */
const TRANSITIONS = {
  quote: { from: "submitted", to: "quoted" },
  reject: { from: "submitted", to: "rejected" },
  accept: { from: "quoted", to: "accepted" },
  decline: { from: "quoted", to: "rejected" },
} as const satisfies Record<string, { from: Status; to: Status }>;
type Action = keyof typeof TRANSITIONS;

interface Row {
  id: number;
  user_id: number;
  status: Status;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  note: string;
  quote_cents: number | null;
  quote_expires_at: Date | null;
  reject_reason: string | null;
  order_number: string | null;
}

export interface TradeIn {
  id: number;
  status: Status;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  note: string;
  quote_cents: number | null;
  quote_expires_at: string | null;
  reject_reason: string | null;
  order_number: string | null;
}

/** A quoted trade-in reads as expired from the instant now ≥ quote_expires_at. */
function effective(row: Row): Status {
  return row.status === "quoted" && row.quote_expires_at && now() >= row.quote_expires_at ? "expired" : row.status;
}

function present(row: Row): TradeIn {
  return {
    id: row.id, status: effective(row), brand: row.brand, model_year: row.model_year, condition: row.condition, serial: row.serial,
    note: row.note, quote_cents: row.quote_cents, quote_expires_at: row.quote_expires_at ? iso(row.quote_expires_at) : null,
    reject_reason: row.reject_reason, order_number: row.order_number,
  };
}

function illegal(): ApiError {
  return new ApiError("illegal_transition", { message: "This trade-in cannot be changed now." });
}

function move(row: Row, action: Action): Status {
  const step = TRANSITIONS[action];
  const status = effective(row);
  if (action === "accept" && status === "expired") throw new ApiError("quote_expired");
  if (status !== step.from) throw illegal();
  return step.to;
}

const SELECT = "SELECT id, user_id, status, brand, model_year, condition, serial, note, quote_cents, quote_expires_at, reject_reason, order_number FROM trade_ins";

async function row(db: Db, id: string, lock = false): Promise<Row | undefined> {
  if (!/^\d{1,9}$/.test(id)) return undefined;
  return (await db.query<Row>(`${SELECT} WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
}

async function own(db: Db, user: User, id: string, lock = false): Promise<Row> {
  const found = await row(db, id, lock);
  if (!found || found.user_id !== user.id) throw new ApiError("not_found");
  return found;
}

export async function submitTradeIn(user: User, body: Record<string, unknown>): Promise<TradeIn> {
  const fields: Fields = {};
  if (!(TRADE_IN_BRANDS as readonly unknown[]).includes(body.brand)) fields.brand = "Choose your current board.";
  const year = body.model_year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2018 || year > 2025) fields.model_year = "Enter a model year from 2018 to 2025.";
  if (body.condition !== "A" && body.condition !== "B" && body.condition !== "C") fields.condition = "Choose condition A, B or C.";
  if (typeof body.serial !== "string" || !/^[A-Za-z0-9]{6,20}$/.test(body.serial)) fields.serial = "Enter 6 to 20 letters and digits.";
  const note = body.note ?? "";
  if (typeof note !== "string" || note.length > 500) fields.note = "Keep your note under 500 characters.";
  assertValid(fields);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    const { rows } = await tx.query<Row>(`${SELECT} WHERE user_id = $1 AND status IN ('submitted', 'quoted', 'accepted')`, [user.id]);
    if (rows.some((r) => effective(r) !== "expired")) throw new ApiError("open_trade_in");
    const inserted = await tx.query<Row>(
      `INSERT INTO trade_ins (user_id, status, brand, model_year, condition, serial, note, submitted_at)
       VALUES ($1, 'submitted', $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, status, brand, model_year, condition, serial, note, quote_cents, quote_expires_at, reject_reason, order_number`,
      [user.id, body.brand, year, body.condition, body.serial, note, now()],
    );
    return present(inserted.rows[0]!);
  });
}

export async function myTradeIns(db: Db, user: User): Promise<TradeIn[]> {
  return (await db.query<Row>(`${SELECT} WHERE user_id = $1 ORDER BY submitted_at DESC, id DESC`, [user.id])).rows.map(present);
}

export async function readTradeIn(db: Db, user: User, id: string): Promise<TradeIn> {
  return present(await own(db, user, id));
}

export async function respond(user: User, id: string, action: "accept" | "decline"): Promise<TradeIn> {
  const refusal = await transaction(async (tx) => {
    const found = await own(tx, user, id, true);
    try {
      const to = move(found, action);
      await tx.query("UPDATE trade_ins SET status = $2 WHERE id = $1", [found.id, to]);
      return { trade: present({ ...found, status: to }) };
    } catch (error) {
      if (error instanceof ApiError && error.code === "quote_expired") {
        await tx.query("UPDATE trade_ins SET status = 'expired' WHERE id = $1", [found.id]);
        return { error };
      }
      throw error;
    }
  });
  if ("error" in refusal) throw refusal.error;
  return refusal.trade;
}

export async function staffTradeIns(db: Db, status: string | null): Promise<TradeIn[]> {
  const all = (await db.query<Row>(`${SELECT} ORDER BY submitted_at, id`)).rows.map(present);
  return status ? all.filter((t) => t.status === status) : all;
}

export async function quoteTradeIn(id: string, body: Record<string, unknown>): Promise<TradeIn> {
  return transaction(async (tx) => {
    const found = await row(tx, id, true);
    if (!found) throw new ApiError("not_found");
    const amount = body.amount_cents;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 100 || amount > 500000) {
      throw invalid({ amount_cents: "Enter an amount from $1.00 to $5,000.00." });
    }
    move(found, "quote");
    const expires = addSeconds(now(), SECONDS.quoteValid);
    await tx.query("UPDATE trade_ins SET status = 'quoted', quote_cents = $2, quote_expires_at = $3 WHERE id = $1", [found.id, amount, expires]);
    const { rows } = await tx.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [found.user_id]);
    await tradeInQuoted(tx, rows[0]!.email, found.id, amount, expires);
    return present({ ...found, status: "quoted", quote_cents: amount, quote_expires_at: expires });
  });
}

export async function rejectTradeIn(id: string, body: Record<string, unknown>): Promise<TradeIn> {
  return transaction(async (tx) => {
    const found = await row(tx, id, true);
    if (!found) throw new ApiError("not_found");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 200) throw invalid({ reason: "Enter a reason of 3 to 200 characters." });
    move(found, "reject");
    await tx.query("UPDATE trade_ins SET status = 'rejected', reject_reason = $2 WHERE id = $1", [found.id, reason]);
    return present({ ...found, status: "rejected", reject_reason: reason });
  });
}
