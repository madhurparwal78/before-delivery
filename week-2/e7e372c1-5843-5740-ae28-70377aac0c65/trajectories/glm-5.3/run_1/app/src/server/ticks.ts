// Signed tick ingestion. The single decision point for tick signature,
// freshness, redelivery and exactly-once storage.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { errors } from "./errors.js";
import { inRegularSession } from "./calendar.js";
import { Decimal } from "./decimal.js";
import { unixSeconds } from "./nytime.js";
import { computeMnavForTick } from "./close.js";

export interface TickBody {
  id?: unknown;
  instrument?: unknown;
  price?: unknown;
  at?: unknown;
}

export interface TickInput {
  id: string;
  instrument: "ETH-USD" | "VLCH";
  price: string;
}

const TICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PRICE_PATTERN = /^\d+(\.\d{1,8})?$/;

export function parseTickBody(body: TickBody): TickInput | { error: { fields: Record<string, string> } } {
  const fields: Record<string, string> = {};
  if (typeof body.id !== "string" || !TICK_ID_PATTERN.test(body.id)) {
    fields.id = "Enter a tick id of up to 64 letters, digits, underscores or hyphens.";
  }
  if (body.instrument !== "ETH-USD" && body.instrument !== "VLCH") {
    fields.instrument = "Use ETH-USD or VLCH.";
  }
  if (typeof body.price !== "string" || !PRICE_PATTERN.test(body.price) || Decimal.fromString(body.price)?.isZero()) {
    fields.price = "Enter a positive price with up to 8 fractional digits.";
  }
  if (Object.keys(fields).length > 0) return { error: { fields } };
  return {
    id: body.id as string,
    instrument: body.instrument as "ETH-USD" | "VLCH",
    price: body.price as string,
  };
}

export function verifyTickSignature(rawBody: string, header: string | undefined, tickKeyHex: string): void {
  if (!header) throw errors.badSignature();
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) throw errors.badSignature();
  const t = match[1] ?? "0";
  const v1 = match[2] ?? "";
  const mac = createHmac("sha256", Buffer.from(tickKeyHex, "ascii")).update(`${t}.${rawBody}`, "utf8");
  const expected = mac.digest("hex");
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"))) throw errors.badSignature();
}

export function checkSignatureFreshness(header: string | undefined, marketNowSec: number): void {
  if (!header) throw errors.badSignature();
  const match = /^t=(\d+),v1=/.exec(header.trim());
  if (!match) throw errors.badSignature();
  const t = Number(match[1] ?? "0");
  if (Math.abs(marketNowSec - t) > 300) throw errors.staleSignature();
}

export async function getTickKey(): Promise<string> {
  const { rows } = await pool.query<{ key_hex: string }>(`SELECT key_hex FROM tick_key WHERE id = 1`);
  return rows[0]?.key_hex ?? "";
}

export interface IngestResult {
  status: number;
  body: { tick: { id: string; instrument: string; price: string; at: string } };
}

/**
 * The signed ingestion entry point: the HTTP endpoint and the tape both go
 * through here, so signature, freshness, redelivery and exactly-once storage
 * have exactly one implementation.
 */
export async function ingestTick(rawBody: string, signatureHeader: string | undefined): Promise<IngestResult> {
  const { marketNow } = await import("./clock.js");
  const now = await marketNow();

  // Signature checks, in order: malformed or mismatched, then stale.
  verifyTickSignature(rawBody, signatureHeader, await getTickKey());
  checkSignatureFreshness(signatureHeader, unixSeconds(now));

  let parsedBody: TickBody;
  try {
    parsedBody = JSON.parse(rawBody) as TickBody;
  } catch {
    throw errors.invalidJson();
  }
  const parsed = parseTickBody(parsedBody);
  if ("error" in parsed) throw errors.validationFailed(parsed.error.fields);

  const result = await acceptTick(parsed, now);
  const tick = result.tick;
  const { isoString } = await import("./nytime.js");
  return {
    status: result.status,
    body: { tick: { id: tick.id, instrument: tick.instrument, price: tick.price, at: isoString(tick.at) } },
  };
}

export interface StoredTick {
  id: string;
  instrument: string;
  price: string;
  at: number;
}

/** Exact same instrument and price compares as exact decimals. */
function sameTickData(a: { instrument: string; price: string }, b: { instrument: string; price: string }): boolean {
  if (a.instrument !== b.instrument) return false;
  const da = Decimal.fromString(a.price);
  const db = Decimal.fromString(b.price);
  if (!da || !db) return false;
  return da.equals(db);
}

/**
 * Exactly-once storage. The tick id's primary key decides the race; the
 * winner stores the tick and computes mNAV, losers read the stored row.
 */
export async function acceptTick(
  tick: TickInput,
  nowMs: number,
): Promise<{ status: 201; tick: StoredTick } | { status: 200; tick: StoredTick }> {
  return withTickTransaction(async (client) => {
    const existing = await client.query<StoredTickRow>(`SELECT id, instrument, price, at FROM ticks WHERE id = $1`, [
      tick.id,
    ]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as StoredTickRow;
      if (sameTickData({ instrument: row.instrument, price: row.price }, tick)) {
        return { status: 200, tick: { id: row.id, instrument: row.instrument, price: row.price, at: Number(row.at) } };
      }
      throw errors.tickIdConflict();
    }

    // Session rule for share-price ticks, decided on the market clock.
    if (tick.instrument === "VLCH" && !inRegularSession(nowMs)) throw errors.sessionClosed();

    const at = nowMs;
    const inserted = await client.query<StoredTickRow>(
      `INSERT INTO ticks (id, instrument, price, at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, instrument, price, at`,
      [tick.id, tick.instrument, tick.price, String(at)],
    );
    if (inserted.rows.length === 0) {
      // Lost the race: another delivery stored this id first.
      const winner = await client.query<StoredTickRow>(`SELECT id, instrument, price, at FROM ticks WHERE id = $1`, [
        tick.id,
      ]);
      const row = winner.rows[0] as StoredTickRow | undefined;
      if (row && sameTickData({ instrument: row.instrument, price: row.price }, tick)) {
        return { status: 200, tick: { id: row.id, instrument: row.instrument, price: row.price, at: Number(row.at) } };
      }
      throw errors.tickIdConflict();
    }
    const stored = inserted.rows[0] as StoredTickRow;
    await storeTickMnav(client, tick, at);
    return { status: 201, tick: { id: stored.id, instrument: stored.instrument, price: stored.price, at: Number(stored.at) } };
  });
}

interface StoredTickRow {
  id: string;
  instrument: string;
  price: string;
  at: string;
}

async function withTickTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function storeTickMnav(client: PoolClient, tick: TickInput, at: number): Promise<void> {
  await computeMnavForTick(client, tick, at);
}

export async function latestEthTick(client?: PoolClient): Promise<StoredTick | null> {
  const queryText = `SELECT id, instrument, price, at FROM ticks WHERE instrument = 'ETH-USD' ORDER BY at DESC, id DESC LIMIT 1`;
  const result = client
    ? await client.query<StoredTickRow>(queryText)
    : await pool.query<StoredTickRow>(queryText);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as StoredTickRow;
  return { id: row.id, instrument: row.instrument, price: row.price, at: Number(row.at) };
}

/** The most recent official close strictly before `atMs`: the last VLCH tick at or before it. */
export async function latestOfficialCloseBefore(atMs: number): Promise<StoredTick | null> {
  const { rows } = await pool.query<StoredTickRow>(
    `SELECT id, instrument, price, at FROM ticks WHERE instrument = 'VLCH' AND at <= $1 ORDER BY at DESC LIMIT 1`,
    [String(atMs)],
  );
  if (rows.length === 0) return null;
  const row = rows[0] as StoredTickRow;
  return { id: row.id, instrument: row.instrument, price: row.price, at: Number(row.at) };
}

/** The last VLCH tick of a New York date's session (the official close), or null. */
export async function officialCloseForDate(date: string): Promise<StoredTick | null> {
  const { sessionForDate } = await import("./calendar.js");
  const session = sessionForDate(date);
  if (!session || !session.tradingDay || session.closeAt === null) return null;
  const { rows } = await pool.query<StoredTickRow>(
    `SELECT id, instrument, price, at FROM ticks
      WHERE instrument = 'VLCH' AND at >= $1 AND at < $2
      ORDER BY at DESC LIMIT 1`,
    [String(session.openAt), String(session.closeAt)],
  );
  if (rows.length === 0) return null;
  const row = rows[0] as StoredTickRow;
  return { id: row.id, instrument: row.instrument, price: row.price, at: Number(row.at) };
}

export { unixSeconds };
