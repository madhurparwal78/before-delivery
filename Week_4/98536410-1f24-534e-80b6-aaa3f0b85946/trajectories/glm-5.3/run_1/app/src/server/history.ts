import * as crypto from "crypto";
import type { PoolClient } from "pg";

export interface TxClient extends PoolClient {}

export interface OrderEventRow {
  order_id: string;
  seq: number;
  type: string;
  at: Date;
  data: unknown;
  digest: string;
}

const TWO_64_ZEROS = "0".repeat(64);

export type OrderEventBody = {
  at: string;
  data: unknown;
  order_id: string;
  seq: number;
  type: string;
};

export function canonicalEventBody(entry: { at: Date; data: unknown; order_id: string; seq: number; type: string }): string {
  const body: OrderEventBody = { at: formatEventAt(entry.at), data: entry.data, order_id: entry.order_id, seq: entry.seq, type: entry.type };
  return canonicalJson(body);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical body");
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return jsonEscape(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${jsonEscape(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported value in canonical body");
}

function jsonEscape(value: string): string {
  let out = "\"";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (char === "\"") out += "\\\"";
    else if (char === "\\") out += "\\\\";
    else if (code !== undefined && code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}\"`;
}

export function eventDigest(previousDigest: string, entry: { at: Date; data: unknown; order_id: string; seq: number; type: string }): string {
  const payload = previousDigest + canonicalEventBody(entry);
  return cryptoHash(payload);
}

function cryptoHash(payload: string): string {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export async function nextSeqForOrder(client: TxClient, orderId: string): Promise<number> {
  const result = await client.query<{ seq: number }>("select coalesce(max(seq),0)+1 as seq from order_events where order_id=$1", [orderId]);
  return result.rows[0].seq;
}

export async function appendOrderEvent(
  client: TxClient,
  orderId: string,
  seq: number,
  type: string,
  data: unknown,
  at: Date,
  previousDigest: string,
): Promise<void> {
  const digest = eventDigest(previousDigest, { at, data, order_id: orderId, seq, type });
  await client.query(
    "insert into order_events (order_id, seq, type, at, data, digest) values ($1,$2,$3,$4,$5,$6)",
    [orderId, seq, type, at, data === null ? JSON.stringify(null) : JSON.stringify(data), digest],
  );
}

export async function lastDigest(client: TxClient, orderId: string): Promise<{ seq: number; digest: string }> {
  const result = await client.query<{ seq: number; digest: string }>(
    "select seq, digest from order_events where order_id=$1 order by seq desc limit 1",
    [orderId],
  );
  if (result.rows.length === 0) return { seq: 0, digest: TWO_64_ZEROS };
  return { seq: result.rows[0].seq, digest: result.rows[0].digest };
}

export interface ChainCheckResult {
  ok: boolean;
  firstBadSeq: number | null;
  entries: OrderEventRow[];
}

export function checkChain(entries: OrderEventRow[]): ChainCheckResult {
  let previousDigest = TWO_64_ZEROS;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) return { ok: false, firstBadSeq: entry.seq, entries };
    const digest = eventDigest(previousDigest, { at: entry.at, data: entry.data, order_id: entry.order_id, seq: entry.seq, type: entry.type });
    if (digest !== entry.digest) return { ok: false, firstBadSeq: entry.seq, entries };
    previousDigest = entry.digest;
    expectedSeq += 1;
  }
  return { ok: true, firstBadSeq: null, entries };
}

export function formatEventAt(at: Date): string {
  return `${at.toISOString().slice(0, 23)}Z`;
}
