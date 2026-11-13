import type { App } from './app.js';
import type { Pool } from './db.js';
import { getConfig } from './config.js';
import type { AssetCode, OracleStatus } from '../shared/types.js';
import { currentPrices, canonical, priceApi, positionFigures } from './market.js';
import { ASSETS } from '../shared/assets.js';
import { randomUUID } from 'node:crypto';
import { problem } from './problems.js';
import { setProcessOracleStatus } from './oracleStatus.js';

interface OracleReading {
  feed: string;
  round: number;
  mantissa: string;
  exponent: number;
  publish_time: number;
}

/** Convert a mantissa and exponent to price units with integer arithmetic only. */
export function convertReading(mantissa: bigint, exponent: number): bigint {
  if (exponent >= -8) return mantissa * 10n ** BigInt(exponent + 8);
  return mantissa / 10n ** BigInt(-exponent - 8);
}

function parseReading(raw: string): OracleReading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  if (typeof body.feed !== 'string') return null;
  if (typeof body.round !== 'number' || !Number.isInteger(body.round) || body.round <= 0) return null;
  const price = body.price;
  if (typeof price !== 'object' || price === null) return null;
  const priceRecord = price as Record<string, unknown>;
  if (typeof priceRecord.mantissa !== 'string' || !/^[1-9][0-9]{0,37}$/.test(priceRecord.mantissa)) return null;
  if (typeof priceRecord.exponent !== 'number' || !Number.isInteger(priceRecord.exponent) || priceRecord.exponent < -18 || priceRecord.exponent > 0) return null;
  if (typeof body.publish_time !== 'number' || !Number.isInteger(body.publish_time) || body.publish_time <= 0) return null;
  return {
    feed: body.feed,
    round: body.round,
    mantissa: priceRecord.mantissa,
    exponent: priceRecord.exponent,
    publish_time: body.publish_time,
  };
}

/** Poll one asset's feed, apply a fresh reading at most once per round, update the status. */
export async function pollOnce(app: App, asset: AssetCode): Promise<void> {
  const cfg = getConfig();
  const url = `${cfg.wiremockUrl.replace(/\/$/, '')}${cfg.oraclePathPrefix}/feeds/${asset}-USD/latest`;
  let statusText = '';
  let raw = '';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    statusText = `status ${response.status}`;
    if (response.status !== 200) {
      setOracleStatus(app, asset, 'unreachable');
      return;
    }
    raw = await response.text();
  } catch {
    setOracleStatus(app, asset, 'unreachable');
    return;
  }
  void statusText;
  const reading = parseReading(raw);
  const nowSec = Math.floor(Date.now() / 1000);
  if (reading === null || reading.feed !== `${asset}-USD` || reading.publish_time > nowSec + 5) {
    setOracleStatus(app, asset, 'malformed');
    return;
  }
  const price = convertReading(BigInt(reading.mantissa), reading.exponent);
  if (price <= 0n) {
    setOracleStatus(app, asset, 'malformed');
    return;
  }
  await considerReading(app, asset, reading, price, raw, nowSec);
}

async function considerReading(app: App, asset: AssetCode, reading: OracleReading, price: bigint, raw: string, nowSec: number): Promise<void> {
  const evidenceKey = `evidence/prices/${randomUUID()}.json`;
  const publishAt = new Date(reading.publish_time * 1000);
  let outcome: OracleStatus = 'ok';
  let stored = false;
  try {
    stored = await app.db.transaction(async (tx): Promise<boolean> => {
      const current = await currentPrices(tx.client);
      const prev = current.get(asset);
      if (prev === undefined) throw new Error('missing price');
      const appliedRound = await tx.query<{ round: string; publish_time: string; price: string }>(
        'SELECT round::text, publish_time::text, price::text FROM oracle_applied WHERE asset = $1 ORDER BY round DESC LIMIT 1 FOR UPDATE',
        [asset],
      );
      const lastApplied = appliedRound.rows[0];
      if (lastApplied !== undefined) {
        const lastRound = BigInt(lastApplied.round);
        if (BigInt(reading.round) < lastRound
          || (BigInt(reading.round) === lastRound
            && (price !== BigInt(lastApplied.price) || reading.publish_time !== Number(lastApplied.publish_time)))) {
          outcome = 'old_round';
          return false;
        }
        if (BigInt(reading.round) === lastRound) {
          if (prev.source === 'oracle' && prev.oracle_round === lastRound.toString() && prev.price === price) {
            outcome = 'ok';
            return false;
          }
          outcome = 'not_newer';
          return false;
        }
      }
      if (publishAt.getTime() <= prev.posted_at.getTime()) {
        outcome = 'not_newer';
        return false;
      }
      if (price !== prev.price) {
        const lower = price < prev.price ? price : prev.price;
        const higher = price > prev.price ? price : prev.price;
        if (higher * 10n > lower * 16n) {
          outcome = 'large_move';
          return false;
        }
      }
      const already = await tx.query<{ price_post_id: string }>(
        'SELECT price_post_id FROM oracle_applied WHERE asset = $1 AND round = $2',
        [asset, reading.round],
      );
      if (already.rows.length > 0) {
        outcome = 'ok';
        return false;
      }
      // Store evidence before the reading counts.
      const pricePostId = randomUUID();
      const wasStale = (nowSec - Math.floor(prev.posted_at.getTime() / 1000)) > getConfig().stalenessSeconds;
      const evidence: Record<string, unknown> = {
        price_post_id: pricePostId,
        asset,
        price: priceApi(price),
        previous_price: priceApi(prev.price),
        posted_at: canonical(publishAt),
        posted_by: 'oracle',
        source: 'oracle',
        positions_below_one: 0,
        positions: [],
        oracle_response: raw,
      };
      try {
        await app.store.ensureBucket();
        await app.store.putOnce(evidenceKey, JSON.stringify(evidence, null, 2), 'application/json');
      } catch {
        outcome = 'evidence_unavailable';
        return false;
      }
      await tx.query(
        `INSERT INTO price_posts (price_post_id, asset, price, previous_price, posted_at, posted_by, source, oracle_round, evidence_key)
         VALUES ($1, $2, $3, $4, $5, 'oracle', 'oracle', $6, $7)`,
        [pricePostId, asset, price.toString(), prev.price.toString(), publishAt, reading.round, evidenceKey],
      );
      await tx.query('UPDATE current_prices SET price_post_id = $1 WHERE asset = $2', [pricePostId, asset]);
      await tx.query(
        'INSERT INTO oracle_applied (asset, round, publish_time, price) VALUES ($1, $2, $3, $4)',
        [asset, reading.round, reading.publish_time, price.toString()],
      );
      void wasStale;
      return true;
    });
  } catch (err) {
    if ((err as { status?: number }).status === 503) {
      setOracleStatus(app, asset, 'unreachable');
      return;
    }
    throw err;
  }
  if (!stored) {
    setOracleStatus(app, asset, outcome);
    return;
  }
  await app.db.transaction(async (tx): Promise<void> => {
    await reevaluateForOracle(tx, asset, new Date(nowSec * 1000));
  }).catch((): void => undefined);
  setOracleStatus(app, asset, 'ok');
}

/** Re-evaluate positions after an oracle post, granting recovery grace when the market reopens. */
async function reevaluateForOracle(tx: import('./db.js').Tx, asset: AssetCode, now: Date): Promise<void> {
  const cfg = getConfig();
  const nowSec = Math.floor(now.getTime() / 1000);
  const prices = await currentPrices(tx.client);
  const prevStaleRow = await tx.query<{ posted_at: Date }>(
    `SELECT pp2.posted_at FROM price_posts pp2
     WHERE pp2.asset = $1 AND pp2.price_post_id <> (SELECT price_post_id FROM current_prices WHERE asset = $1)
     ORDER BY pp2.posted_at DESC LIMIT 1`,
    [asset],
  );
  void prevStaleRow;
  const rows = await tx.query<import('./evaluation.js').PositionRow & { threshold: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE p.state <> 'closed' ORDER BY p.position_id FOR UPDATE OF p`,
  );
  const current = prices.get(asset);
  const graceEnds = new Map<string, bigint>();
  for (const row of rows.rows) {
    if (row.collateral_asset !== asset && row.debt_asset !== asset) continue;
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const { evaluatePosition, applyEvaluation } = await import('./evaluation.js');
    const result = evaluatePosition(row, {
      collateralPrice: collateralPrice.price,
      debtPrice: debtPrice.price,
      thresholdBps: row.threshold,
      graceSeconds: cfg.graceSeconds,
      nowSec,
    });
    await applyEvaluation(tx, row, result, now, false);
    if (result.hfScaled !== null && result.hfScaled < 10_000n) {
      const existing = row.grace_ends_at === null ? 0n : BigInt(row.grace_ends_at);
      const offered = BigInt(nowSec + cfg.graceSeconds);
      graceEnds.set(row.position_id, existing > offered ? existing : offered);
    }
  }
  void current;
}

function setOracleStatus(app: App, asset: AssetCode, status: OracleStatus): void {
  void app;
  setProcessOracleStatus(asset, status);
}

/** Poll every asset forever on this process's interval. */
export function startPolling(app: App): NodeJS.Timeout {
  const cfg = getConfig();
  const interval = Math.max(1, cfg.oraclePollSeconds) * 1000;
  const tick = (): void => {
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      void pollOnce(app, code).catch((): void => undefined);
    }
  };
  tick();
  return setInterval(tick, interval);
}
