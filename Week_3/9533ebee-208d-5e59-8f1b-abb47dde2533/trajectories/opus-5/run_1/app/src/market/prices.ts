/**
 * Applying a price post, whether the steward's manual override or an accepted
 * oracle reading. Every post stores its evidence before it counts, re-values
 * every open position, and grants a recovery grace when it reopens a market
 * that was stale.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { readBig, readInstant, writeInstant, type Queryable } from '../db/pool.ts';
import { apiHealthFactor, apiPrice } from '../domain/apiformat.ts';
import { assetScale, type Asset } from '../domain/assets.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { healthFactorScaled, liquidationPrice } from '../domain/position.ts';
import { putObject, StorageUnreachable } from '../services/s3.ts';
import { statementStoreUnavailable } from '../http/problem.ts';
import {
  evaluateAllOpenPositions,
  listPositionsTouchingAsset,
  type PositionRow,
} from './positions.ts';
import { isStale, loadAsset, loadAssets, type AssetStates } from './state.ts';

export const evidenceKeyFor = (pricePostId: string): string =>
  `evidence/prices/${pricePostId}.json`;

export interface PricePostInput {
  readonly asset: Asset;
  readonly price: bigint;
  readonly postedBy: string;
  readonly source: 'manual' | 'oracle';
  readonly oracleRound: number | null;
  /** Server now for a manual post; the publication instant for a reading. */
  readonly postedAtMs: number;
  /** A manual post's submitted fields, exactly as sent. */
  readonly submitted: Readonly<Record<string, unknown>> | null;
  /** An oracle reading's raw response body, byte for byte. */
  readonly oracleResponse: string | null;
}

export interface PricePostResult {
  readonly pricePostId: string;
  readonly previousPrice: bigint;
  readonly positionsBelowOne: number;
  readonly evidenceKey: string;
}

/** Locks every asset row, always in the same order, so posts never deadlock. */
async function lockAllAssets(client: Queryable): Promise<void> {
  await client.query('SELECT asset FROM assets ORDER BY asset FOR UPDATE');
}

function healthAfterPost(
  row: PositionRow,
  assets: AssetStates,
): { healthScaled: bigint | null; liquidation: bigint | null } {
  const threshold = assets[row.collateralAsset].settings.liquidationThresholdBps;
  const valuation = {
    collateral: row.collateral,
    debt: row.debt,
    collateralPrice: assets[row.collateralAsset].price.price,
    debtPrice: assets[row.debtAsset].price.price,
    collateralScale: assetScale(row.collateralAsset),
    debtScale: assetScale(row.debtAsset),
  };
  return {
    healthScaled: healthFactorScaled(valuation, threshold),
    liquidation: liquidationPrice(valuation, threshold),
  };
}

/**
 * Records the post, re-values the book and stores the evidence. Runs inside
 * the caller's transaction, so a post whose evidence cannot be stored records
 * nothing.
 */
export async function applyPricePost(
  client: Queryable,
  input: PricePostInput,
  nowMs: number,
): Promise<PricePostResult> {
  await lockAllAssets(client);

  const before = await loadAsset(client, input.asset);
  const wasStale = isStale(before.price, nowMs);
  const previousPrice = before.price.price;

  const pricePostId = randomUUID();
  const evidenceKey = evidenceKeyFor(pricePostId);
  await client.query(
    `INSERT INTO price_posts (price_post_id, asset, price, previous_price, posted_at,
                              posted_by, source, oracle_round, evidence_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      pricePostId,
      input.asset,
      input.price.toString(),
      previousPrice.toString(),
      writeInstant(input.postedAtMs),
      input.postedBy,
      input.source,
      input.oracleRound,
      evidenceKey,
      writeInstant(nowMs),
    ],
  );
  await client.query('UPDATE assets SET current_price_post_id = $1 WHERE asset = $2', [
    pricePostId,
    input.asset,
  ]);

  const assets = await loadAssets(client);

  // A post that takes an asset from stale to open grants a recovery grace to
  // every open position on that asset still below health factor 1. Setting
  // the stored grace end before evaluating lets the one state machine produce
  // `liquidatable_grace` and keep the after-fill mark.
  if (wasStale && !isStale(assets[input.asset].price, nowMs)) {
    const touching = await listPositionsTouchingAsset(client, input.asset);
    const recoveryEnd = nowMs + config.graceSeconds * 1000;
    for (const row of touching) {
      const { healthScaled } = healthAfterPost(row, assets);
      if (healthScaled === null || healthScaled >= 10000n) continue;
      const end =
        row.graceEndsAtMs === null ? recoveryEnd : Math.max(row.graceEndsAtMs, recoveryEnd);
      await client.query('UPDATE positions SET grace_ends_at = $1 WHERE position_id = $2', [
        writeInstant(end),
        row.positionId,
      ]);
    }
  }

  const evaluated = await evaluateAllOpenPositions(client, assets, nowMs);

  let positionsBelowOne = 0;
  for (const row of evaluated) {
    const { healthScaled } = healthAfterPost(row, assets);
    if (healthScaled !== null && healthScaled < 10000n) positionsBelowOne += 1;
  }

  const touching = evaluated.filter(
    (row) => row.collateralAsset === input.asset || row.debtAsset === input.asset,
  );
  const evidence: Record<string, unknown> = {
    price_post_id: pricePostId,
    asset: input.asset,
    price: apiPrice(input.price),
    previous_price: apiPrice(previousPrice),
    posted_at: formatCanonicalUtc(input.postedAtMs),
    posted_by: input.postedBy,
    source: input.source,
    positions_below_one: positionsBelowOne,
    positions: touching.map((row) => {
      const { healthScaled, liquidation } = healthAfterPost(row, assets);
      return {
        position_id: row.positionId,
        health_factor: apiHealthFactor(healthScaled),
        liquidation_price: liquidation === null ? null : apiPrice(liquidation),
      };
    }),
  };
  if (input.submitted !== null) evidence['submitted'] = input.submitted;
  if (input.oracleResponse !== null) evidence['oracle_response'] = input.oracleResponse;

  try {
    await putObject(evidenceKey, JSON.stringify(evidence), 'application/json');
  } catch (error) {
    if (error instanceof StorageUnreachable) throw statementStoreUnavailable();
    throw error;
  }

  return { pricePostId, previousPrice, positionsBelowOne, evidenceKey };
}

export interface PricePostRecord {
  readonly pricePostId: string;
  readonly asset: Asset;
  readonly price: bigint;
  readonly postedAtMs: number;
  readonly postedBy: string;
  readonly source: 'manual' | 'oracle';
  readonly oracleRound: number | null;
  readonly evidenceKey: string | null;
}

export async function listPricePosts(
  client: Queryable,
  asset: Asset | null,
): Promise<PricePostRecord[]> {
  const values = asset === null ? [] : [asset];
  const where = asset === null ? '' : 'WHERE asset = $1';
  const result = await client.query<{
    price_post_id: string;
    asset: string;
    price: string;
    posted_at: Date;
    posted_by: string;
    source: string;
    oracle_round: number | null;
    evidence_key: string | null;
  }>(
    `SELECT price_post_id, asset, price, posted_at, posted_by, source, oracle_round, evidence_key
     FROM price_posts ${where} ORDER BY posted_at DESC, seq_no DESC`,
    values,
  );
  return result.rows.map((row) => ({
    pricePostId: row.price_post_id,
    asset: row.asset as Asset,
    price: readBig(row.price),
    postedAtMs: readInstant(row.posted_at),
    postedBy: row.posted_by,
    source: row.source === 'oracle' ? 'oracle' : 'manual',
    oracleRound: row.oracle_round,
    evidenceKey: row.evidence_key,
  }));
}

/** What the oracle ladder needs to know about an asset's standing. */
export async function priceStanding(client: Queryable, asset: Asset) {
  const current = await loadAsset(client, asset);
  const lastOracle = await client.query<{
    price: string;
    posted_at: Date;
    oracle_round: number;
  }>(
    `SELECT price, posted_at, oracle_round FROM price_posts
     WHERE asset = $1 AND source = 'oracle'
     ORDER BY oracle_round DESC, seq_no DESC LIMIT 1`,
    [asset],
  );
  const row = lastOracle.rows[0];
  return {
    currentPrice: current.price.price,
    currentPostedAtMs: current.price.postedAtMs,
    currentIsOracle: current.price.source === 'oracle',
    lastAppliedRound: row === undefined ? null : row.oracle_round,
    lastAppliedPrice: row === undefined ? null : readBig(row.price),
    lastAppliedPublishedAtMs: row === undefined ? null : readInstant(row.posted_at),
  };
}
