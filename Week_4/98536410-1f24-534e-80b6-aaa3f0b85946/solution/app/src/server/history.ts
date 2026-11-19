// The order history: appended entries chained by digest, checked on every read, replayable into the order state.
import { createHash } from "node:crypto";
import { type Db, one, query } from "./db.js";
import { ApiError } from "./errors.js";
import { type OrderStatus, type ReturnStatus, isOrderStatus, isReturnStatus } from "../shared/transitions.js";
import { type Json, canonicalJson } from "./json.js";

const ZERO_DIGEST = "0".repeat(64);

type EntryType =
  | "order.placed" | "order.picking" | "order.ready" | "order.collected" | "order.cancelled"
  | "return.requested" | "return.received" | "return.settled" | "return.declined";

interface HistoryEntry {
  seq: number;
  type: string;
  at: string;
  data: Json;
  digest: string;
}

interface EntryRow {
  seq: number;
  type: string;
  at: Date;
  data: Json;
  digest: string;
}

/** SHA-256 of the previous digest followed directly by the canonical body of this entry. */
function digestOf(previous: string, orderId: string, entry: Omit<HistoryEntry, "digest">): string {
  const body = canonicalJson({ at: entry.at, data: entry.data, order_id: orderId, seq: entry.seq, type: entry.type });
  return createHash("sha256").update(previous, "utf8").update(body, "utf8").digest("hex");
}

function entryOf(row: EntryRow): HistoryEntry {
  return { seq: row.seq, type: row.type, at: row.at.toISOString(), data: row.data, digest: row.digest };
}

/** The entries in order, or the sequence_broken refusal naming the first entry that fails its check. */
export async function readChain(db: Pick<Db, "query">, orderId: string): Promise<HistoryEntry[]> {
  const rows = await query<EntryRow>(db, "SELECT seq, type, at, data, digest FROM order_events WHERE order_id = $1 ORDER BY seq", [orderId]);
  let previous = ZERO_DIGEST;
  let expectedSeq = 1;
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    const entry = entryOf(row);
    if (entry.seq !== expectedSeq || entry.digest !== digestOf(previous, orderId, entry)) {
      throw new ApiError(409, "sequence_broken", { first_bad_seq: entry.seq });
    }
    previous = entry.digest;
    expectedSeq += 1;
    entries.push(entry);
  }
  return entries;
}

export async function appendEntry(db: Db, orderId: string, type: EntryType, data: Json, now: Date): Promise<HistoryEntry> {
  const last = await one<{ seq: number; digest: string }>(db, "SELECT seq, digest FROM order_events WHERE order_id = $1 ORDER BY seq DESC LIMIT 1", [orderId]);
  const draft = { seq: (last?.seq ?? 0) + 1, type, at: now.toISOString(), data };
  const digest = digestOf(last?.digest ?? ZERO_DIGEST, orderId, draft);
  await db.query("INSERT INTO order_events (order_id, seq, type, at, data, digest) VALUES ($1, $2, $3, $4, $5, $6)",
    [orderId, draft.seq, draft.type, new Date(draft.at), JSON.stringify(draft.data), digest]);
  return { ...draft, digest };
}

interface ReplayedOrder {
  status: OrderStatus;
  last_seq: number;
  total_cents: number;
  refunded_cents: number;
  returns: { id: string; status: ReturnStatus; refund_cents: number }[];
  number: string;
  store_id: string;
}

function field(data: Json, name: string): Json {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data[name] ?? null) : null;
}

function orderStatusOf(value: Json): OrderStatus {
  const text = String(value);
  if (!isOrderStatus(text)) throw new Error(`history names no order status "${text}"`);
  return text;
}

function returnStatusOf(value: Json): ReturnStatus {
  const text = String(value);
  if (!isReturnStatus(text)) throw new Error(`history names no return status "${text}"`);
  return text;
}

/** Rebuilds the order state from the entries alone. */
export function replay(entries: HistoryEntry[]): ReplayedOrder {
  const state: ReplayedOrder = { status: "placed", last_seq: 0, total_cents: 0, refunded_cents: 0, returns: [], number: "", store_id: "" };
  for (const entry of entries) {
    state.last_seq = entry.seq;
    if (entry.type === "order.placed") {
      state.status = "placed";
      state.total_cents = Number(field(entry.data, "total_cents"));
      state.number = String(field(entry.data, "number"));
      state.store_id = String(field(entry.data, "store_id"));
    } else if (entry.type.startsWith("order.")) {
      state.status = orderStatusOf(field(entry.data, "to"));
    } else if (entry.type === "return.requested") {
      state.returns.push({ id: String(field(entry.data, "return_id")), status: "requested", refund_cents: Number(field(entry.data, "refund_cents")) });
    } else {
      const target = state.returns.find((item) => item.id === field(entry.data, "return_id"));
      if (target) target.status = returnStatusOf(field(entry.data, "to"));
    }
  }
  state.refunded_cents = state.returns.filter((item) => item.status === "settled").reduce((sum, item) => sum + item.refund_cents, 0);
  return state;
}

/** Rebuilds the order summary row from the history. */
export async function rebuildView(db: Db, orderId: string, operatorId: string, entries: HistoryEntry[]): Promise<ReplayedOrder> {
  const state = replay(entries);
  await db.query(
    `INSERT INTO order_view (order_id, operator_id, store_id, number, status, total_cents, refunded_cents, last_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, total_cents = EXCLUDED.total_cents,
       refunded_cents = EXCLUDED.refunded_cents, last_seq = EXCLUDED.last_seq, store_id = EXCLUDED.store_id, number = EXCLUDED.number`,
    [orderId, operatorId, state.store_id, state.number, state.status, state.total_cents, state.refunded_cents, state.last_seq]);
  return state;
}
