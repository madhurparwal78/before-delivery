/**
 * Polling the third-party price oracle. Every server process polls each
 * asset's feed forever, whatever an earlier poll returned, and a reading is
 * applied at most once per asset and round across every process.
 */

import { config } from '../config.ts';
import { transaction } from '../db/pool.ts';
import { ASSET_CODES, type Asset } from '../domain/assets.ts';
import { decideOracleReading, parseOracleBody, type OracleStatus } from '../domain/oracle.ts';
import { applyPricePost, priceStanding } from '../market/prices.ts';
import { isProblem } from '../http/problem.ts';
import { recordOracleStatus } from './oracle-status.ts';

/** Each request has a 1,000 millisecond timeout. */
const READ_TIMEOUT_MS = 1000;

function feedUrl(asset: Asset): string {
  return `${config.wiremockUrl}${config.oraclePathPrefix}/feeds/${asset}-USD/latest`;
}

async function pollAsset(asset: Asset): Promise<OracleStatus> {
  let body: string;
  try {
    const response = await fetch(feedUrl(asset), {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (response.status !== 200) return 'unreachable';
    body = await response.text();
  } catch {
    return 'unreachable';
  }

  const nowMs = Date.now();
  const reading = parseOracleBody(body, asset, nowMs);
  if (reading === null) return 'malformed';

  try {
    return await transaction(async (client) => {
      const standing = await priceStanding(client, asset);
      const decision = decideOracleReading(reading, standing);
      if (!decision.apply) return decision.status;

      await applyPricePost(
        client,
        {
          asset,
          price: reading.priceUnits,
          postedBy: 'oracle',
          source: 'oracle',
          oracleRound: reading.round,
          // an oracle post's posted_at is its publication instant
          postedAtMs: reading.publishedAtMs,
          submitted: null,
          oracleResponse: reading.rawBody,
        },
        nowMs,
      );
      return 'ok';
    });
  } catch (error) {
    // Another process applied this round first; the reading is in force.
    if (isUniqueViolation(error)) return 'ok';
    // The evidence object could not be stored, so nothing was recorded.
    if (isProblem(error) && error.code === 'statement_store_unavailable') {
      return 'evidence_unavailable';
    }
    if (isProblem(error) && error.code === 'ledger_unavailable') return 'unreachable';
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Starts the poll loop for every asset. Each loop keeps polling forever, so a
 * feed that was down at boot recovers without a restart.
 */
export function startOraclePolling(): void {
  for (const asset of ASSET_CODES) {
    const tick = async (): Promise<void> => {
      try {
        recordOracleStatus(asset, await pollAsset(asset));
      } catch {
        recordOracleStatus(asset, 'unreachable');
      }
    };
    void tick();
    setInterval(() => void tick(), config.oraclePollSeconds * 1000).unref();
  }
}
