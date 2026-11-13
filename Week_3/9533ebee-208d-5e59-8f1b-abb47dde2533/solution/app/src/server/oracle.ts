import { config } from "./config.js";
import { inLedger, isDatabaseFailure, one, pool, type Tx } from "./db.js";
import { ApiError } from "./errors.js";
import { loadMarket, type Asset } from "./pools.js";
import { isLargeMove, recordPrice } from "./prices.js";
import { removeAll } from "./storage.js";
import { serverNow } from "./time.js";
import type { OracleStatus } from "../shared/copy.js";

// The price oracle: every server process polls each asset's feed on its own timer, forever. A reading is applied
// at most once per asset and round across every process sharing the database, and one that is not applied
// changes nothing: the last good price stays.

const REQUEST_TIMEOUT_MS = 1000;
const MAX_FUTURE_SECONDS = 5;

/** The status of the latest poll made by this process; until a poll returns it reads `unreachable`. */
const latest = new Map<string, OracleStatus>();

export function oracleStatusOf(asset: string): OracleStatus {
  return latest.get(asset) ?? "unreachable";
}

interface Reading {
  round: number;
  /** Price units, converted with integer arithmetic only. */
  price: bigint;
  publishTime: number;
}

const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Converts a mantissa and exponent to price units (eight decimals): exact above −8, floored below. */
function convert(mantissa: bigint, exponent: number): bigint {
  return exponent >= -8 ? mantissa * 10n ** BigInt(8 + exponent) : mantissa / 10n ** BigInt(-8 - exponent);
}

/** The reading in the response body, or null when the body is not the published shape for this feed. */
function parseReading(body: string, asset: string, now: Date): Reading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const { feed, round, price, publish_time: publishTime } = parsed as Record<string, unknown>;
  if (feed !== `${asset}-USD` || !isWholeNumber(round) || !isWholeNumber(publishTime)) return null;
  if (price === null || typeof price !== "object") return null;
  const { mantissa, exponent } = price as Record<string, unknown>;
  if (typeof mantissa !== "string" || !/^[1-9]\d{0,37}$/.test(mantissa)) return null;
  if (typeof exponent !== "number" || !Number.isInteger(exponent) || exponent < -18 || exponent > 0) return null;
  if (publishTime > now.getTime() / 1000 + MAX_FUTURE_SECONDS) return null;
  const units = convert(BigInt(mantissa), exponent);
  return units === 0n ? null : { round, price: units, publishTime };
}

interface Applied {
  round: number;
  price: bigint;
  postedAt: Date;
}

async function lastApplied(tx: Tx, asset: string): Promise<Applied | undefined> {
  const row = await one<{ oracle_round: string; price: string; posted_at: Date }>(
    tx,
    "SELECT oracle_round::text, price::text, posted_at FROM price_posts WHERE asset = $1 AND oracle_round IS NOT NULL ORDER BY oracle_round DESC LIMIT 1",
    [asset],
  );
  return row ? { round: Number(row.oracle_round), price: BigInt(row.price), postedAt: row.posted_at } : undefined;
}

/** Decides what a reading means for the asset, applying it when it is new, newer and within the move limit. */
async function consider(asset: string, body: string): Promise<OracleStatus> {
  const reading = parseReading(body, asset, serverNow());
  if (reading === null) return "malformed";
  const stored: string[] = [];
  try {
    return await inLedger(async (tx): Promise<OracleStatus> => {
      const market = await loadMarket(tx);
      const current = market.get(asset);
      if (!current) return "malformed";
      const last = await lastApplied(tx, asset);
      if (last && reading.round < last.round) return "old_round";
      if (last && reading.round === last.round) {
        if (reading.price !== last.price || reading.publishTime !== last.postedAt.getTime() / 1000) return "old_round";
        return current.oracleRound === last.round ? "ok" : "not_newer";
      }
      const publishedAt = new Date(reading.publishTime * 1000);
      if (publishedAt <= current.pricePostedAt) return "not_newer";
      if (isLargeMove(current.price, reading.price)) return "large_move";
      // The clock is read under the ledger lock, as every request does, so an evaluation never runs on an instant
      // older than one a request has already used.
      await apply(tx, serverNow(), stored, current, reading, publishedAt, body);
      return "ok";
    });
  } catch (error) {
    await removeAll(stored);
    if (error instanceof ApiError && error.code === "statement_store_unavailable") return "evidence_unavailable";
    throw error;
  }
}

async function apply(tx: Tx, now: Date, stored: string[], asset: Asset, reading: Reading, publishedAt: Date, body: string): Promise<void> {
  await recordPrice(tx, now, stored, asset, reading.price, {
    source: "oracle",
    postedBy: "oracle",
    postedAt: publishedAt,
    oracleRound: reading.round,
    evidence: { oracle_response: body },
  });
}

/** Polls one asset's feed and records what that poll meant. */
async function pollAsset(asset: string): Promise<void> {
  let body: string;
  try {
    const response = await fetch(`${config.oracle.baseUrl}${config.oracle.pathPrefix}/feeds/${asset}-USD/latest`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      latest.set(asset, "unreachable");
      return;
    }
    body = await response.text();
  } catch {
    latest.set(asset, "unreachable");
    return;
  }
  try {
    latest.set(asset, await consider(asset, body));
  } catch (error) {
    if (!isDatabaseFailure(error)) throw error;
    console.error("oracle reading deferred, database unreachable");
  }
}

export async function pollOracle(): Promise<void> {
  const listed = await pool.query<{ asset: string }>("SELECT asset FROM assets ORDER BY listing");
  await Promise.all(listed.rows.map((row) => pollAsset(row.asset)));
}
