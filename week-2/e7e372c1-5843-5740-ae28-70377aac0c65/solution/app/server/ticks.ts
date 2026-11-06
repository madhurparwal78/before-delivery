// Signed price ticks: signature, freshness, redelivery by id, exactly-once storage.

import { createHmac, timingSafeEqual } from "node:crypto";
import { storeMnav } from "./computations.ts";
import { equitySessionAt } from "./calendar.ts";
import { readMarketClock } from "./clock.ts";
import { database, isUniqueViolation, lockLedger, numberValue, one, text, toTimestamp, withTransaction, type Queryable } from "./db.ts";
import { Refusal } from "./errors.ts";
import { catchUpCloses } from "./closes.ts";
import { compareDecimal, parseDecimal } from "../shared/decimal.ts";
import { formatInstant } from "../shared/newyork.ts";

const TICK_WINDOW_SECONDS = 300;

const SIGNATURE_PATTERN = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;
const TICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

let tickKey = "";

export function configureTicks(key: string): void {
  tickKey = key;
}

export function currentTickKey(): string {
  return tickKey;
}

export function signTick(timestampSeconds: number, rawBody: Buffer): string {
  const digest = createHmac("sha256", tickKey).update(`${timestampSeconds}.`).update(rawBody).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

function signedAt(header: string | undefined, rawBody: Buffer): number {
  const match = header ? SIGNATURE_PATTERN.exec(header) : null;
  if (!match) throw new Refusal("bad_signature");
  const timestamp = Number(match[1]);
  const expected = Buffer.from(signTick(timestamp, rawBody));
  const given = Buffer.from(header ?? "");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Refusal("bad_signature");
  return timestamp;
}

function tickView(tick: { id: string; instrument: string; price: string; at: number }): { id: string; instrument: string; price: string; at: string } {
  return { id: tick.id, instrument: tick.instrument, price: tick.price, at: formatInstant(tick.at) };
}

async function storedTick(q: Queryable, id: string): Promise<{ id: string; instrument: string; price: string; at: number } | null> {
  const row = await one(q, "SELECT id, instrument, price, at FROM ticks WHERE id = $1", [id]);
  return row ? { id: text(row, "id"), instrument: text(row, "instrument"), price: text(row, "price"), at: numberValue(row, "at") } : null;
}

interface NewTick {
  id: string;
  instrument: "ETH-USD" | "VLCH";
  price: string;
  at: number;
}

/** Stores a tick and the mNAV it triggers. Callers hold the ledger lock. */
export async function recordTick(q: Queryable, tick: NewTick): Promise<void> {
  const sessionDate = tick.instrument === "VLCH" ? equitySessionAt(tick.at).date : null;
  await q.query("INSERT INTO ticks (id, instrument, price, at, session_date) VALUES ($1, $2, $3, $4::timestamptz, $5)", [tick.id, tick.instrument, tick.price, toTimestamp(tick.at), sessionDate]);
  await storeMnav(q, tick.at, "tick");
}

interface IngestResult {
  status: 200 | 201;
  tick: { id: string; instrument: string; price: string; at: string };
}

function parseTickBody(body: Record<string, unknown>): { fields: Record<string, string>; tick: Omit<NewTick, "at"> | null } {
  const fields: Record<string, string> = {};
  const id = body["id"];
  const instrument = body["instrument"];
  const price = body["price"];
  if (typeof id !== "string" || !TICK_ID_PATTERN.test(id)) fields["id"] = "Use 1 to 64 letters, digits, underscores or hyphens.";
  if (instrument !== "ETH-USD" && instrument !== "VLCH") fields["instrument"] = "Use ETH-USD or VLCH.";
  const parsed = typeof price === "string" ? parseDecimal(price, 8) : null;
  if (typeof price !== "string" || !parsed || parsed.units === 0n) fields["price"] = "Send a positive price with at most 8 decimal places.";
  if (Object.keys(fields).length > 0 || typeof id !== "string" || typeof price !== "string" || (instrument !== "ETH-USD" && instrument !== "VLCH")) {
    return { fields, tick: null };
  }
  return { fields, tick: { id, instrument, price } };
}

function sameTick(stored: { instrument: string; price: string }, instrument: unknown, price: unknown): boolean {
  const left = parseDecimal(stored.price);
  const right = typeof price === "string" ? parseDecimal(price) : null;
  return stored.instrument === instrument && left !== null && right !== null && compareDecimal(left, right) === 0;
}

/** The single path every tick takes, whether an external feeder or the tape player sent it. */
export async function ingestTick(rawBody: Buffer, body: Record<string, unknown>, header: string | undefined): Promise<IngestResult> {
  const timestamp = signedAt(header, rawBody);
  const { now } = await readMarketClock(database());
  if (Math.abs(timestamp - Math.floor(now / 1000)) > TICK_WINDOW_SECONDS) throw new Refusal("stale_signature");
  try {
    return await withTransaction(async (tx) => {
      await lockLedger(tx);
      const rawId = body["id"];
      const replayed = typeof rawId === "string" && TICK_ID_PATTERN.test(rawId) ? await storedTick(tx, rawId) : null;
      if (replayed) {
        if (!sameTick(replayed, body["instrument"], body["price"])) throw new Refusal("tick_id_conflict");
        return { status: 200, tick: tickView(replayed) };
      }
      const acceptedAt = (await readMarketClock(tx)).now;
      if (body["instrument"] === "VLCH" && equitySessionAt(acceptedAt).status !== "open") throw new Refusal("session_closed");
      const { fields, tick } = parseTickBody(body);
      if (!tick) throw new Refusal("validation_failed", fields);
      await catchUpCloses(tx, acceptedAt);
      await recordTick(tx, { ...tick, at: acceptedAt });
      return { status: 201, tick: tickView({ ...tick, at: acceptedAt }) };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await storedTick(database(), typeof body["id"] === "string" ? body["id"] : "");
    if (!winner) throw error;
    if (!sameTick(winner, body["instrument"], body["price"])) throw new Refusal("tick_id_conflict");
    return { status: 200, tick: tickView(winner) };
  }
}
