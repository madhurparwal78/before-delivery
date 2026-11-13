/**
 * Positions: reading them from the ledger, evaluating their state, and the
 * one place that persists a state move, queues its margin notice and writes
 * its integrator event.
 */

import { config } from '../config.ts';
import {
  readBig,
  readInstant,
  readInstantOrNull,
  writeInstant,
  type Queryable,
} from '../db/pool.ts';
import { assetScale, type Asset } from '../domain/assets.ts';
import {
  evaluatePosition,
  healthFactorScaled,
  isLiquidatable,
  liquidationPrice,
  maxRepay,
  queuesMarginNotice,
  type PositionState,
  type PositionValuation,
} from '../domain/position.ts';
import { emitPositionStateChanged } from './events.ts';
import { queueMarginNotice } from './notices.ts';
import type { AssetStates } from './state.ts';

export interface PositionRow {
  readonly positionId: string;
  readonly borrowerId: string;
  readonly collateralAsset: Asset;
  readonly debtAsset: Asset;
  readonly principal: bigint;
  readonly referenceIndex: bigint;
  readonly state: PositionState;
  readonly graceEndsAtMs: number | null;
  readonly afterFillMark: boolean;
  readonly marginNoticeArmed: boolean;
  readonly round: number;
  readonly createdAtMs: number;
  /** The collateral locked in the position, from the ledger. */
  readonly collateral: bigint;
  /** The position's debt, which is minus its loan balance. */
  readonly debt: bigint;
}

interface PositionQueryRow {
  position_id: string;
  borrower_id: string;
  collateral_asset: string;
  debt_asset: string;
  principal: string;
  reference_index: string;
  state: string;
  grace_ends_at: Date | null;
  after_fill_mark: boolean;
  margin_notice_armed: boolean;
  round: number;
  created_at: Date;
  collateral: string;
  debt: string;
}

const POSITION_SELECT = `
  SELECT p.position_id, p.borrower_id, p.collateral_asset, p.debt_asset,
         p.principal, p.reference_index, p.state, p.grace_ends_at,
         p.after_fill_mark, p.margin_notice_armed, p.round, p.created_at,
         COALESCE((SELECT SUM(l.amount) FROM ledger_legs l
                   WHERE l.account = 'collateral:' || p.position_id
                     AND l.asset = p.collateral_asset), 0)::text AS collateral,
         COALESCE(-(SELECT SUM(l.amount) FROM ledger_legs l
                    WHERE l.account = 'loan:' || p.position_id
                      AND l.asset = p.debt_asset), 0)::text AS debt
  FROM positions p`;

function readRow(row: PositionQueryRow): PositionRow {
  return {
    positionId: row.position_id,
    borrowerId: row.borrower_id,
    collateralAsset: row.collateral_asset as Asset,
    debtAsset: row.debt_asset as Asset,
    principal: readBig(row.principal),
    referenceIndex: readBig(row.reference_index),
    state: row.state as PositionState,
    graceEndsAtMs: readInstantOrNull(row.grace_ends_at),
    afterFillMark: row.after_fill_mark,
    marginNoticeArmed: row.margin_notice_armed,
    round: row.round,
    createdAtMs: readInstant(row.created_at),
    collateral: readBig(row.collateral),
    debt: readBig(row.debt),
  };
}

export async function loadPosition(
  client: Queryable,
  positionId: string,
): Promise<PositionRow | null> {
  const result = await client.query<PositionQueryRow>(
    `${POSITION_SELECT} WHERE p.position_id = $1`,
    [positionId],
  );
  const row = result.rows[0];
  return row === undefined ? null : readRow(row);
}

/**
 * Locks a position's row for the rest of the transaction, so liquidations and
 * borrower actions on it are served one at a time across every process.
 * Callers read the position after accruing, because accrual moves its debt.
 */
export async function lockPositionRow(client: Queryable, positionId: string): Promise<void> {
  await client.query('SELECT position_id FROM positions WHERE position_id = $1 FOR UPDATE', [
    positionId,
  ]);
}

/**
 * Reads a position that the router has already resolved and this transaction
 * has already locked.
 */
export async function readLockedPosition(
  client: Queryable,
  positionId: string,
): Promise<PositionRow> {
  const row = await loadPosition(client, positionId);
  if (row === null) throw new Error(`Position ${positionId} vanished inside its transaction`);
  return row;
}

export interface PositionListFilter {
  readonly collateralAsset?: Asset;
  readonly borrowerId?: string;
  readonly includeClosed?: boolean;
  readonly belowHealthFactorOne?: boolean;
}

export async function listPositions(
  client: Queryable,
  filter: PositionListFilter,
): Promise<PositionRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.includeClosed !== true) conditions.push("p.state <> 'closed'");
  if (filter.collateralAsset !== undefined) {
    values.push(filter.collateralAsset);
    conditions.push(`p.collateral_asset = $${values.length}`);
  }
  if (filter.borrowerId !== undefined) {
    values.push(filter.borrowerId);
    conditions.push(`p.borrower_id = $${values.length}`);
  }
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const result = await client.query<PositionQueryRow>(
    `${POSITION_SELECT} ${where} ORDER BY p.position_id`,
    values,
  );
  return result.rows.map(readRow);
}

/** Every open position that touches an asset, as collateral or as debt. */
export async function listPositionsTouchingAsset(
  client: Queryable,
  asset: Asset,
): Promise<PositionRow[]> {
  const result = await client.query<PositionQueryRow>(
    `${POSITION_SELECT}
     WHERE p.state <> 'closed' AND (p.collateral_asset = $1 OR p.debt_asset = $1)
     ORDER BY p.position_id`,
    [asset],
  );
  return result.rows.map(readRow);
}

export async function listOpenPositions(client: Queryable): Promise<PositionRow[]> {
  const result = await client.query<PositionQueryRow>(
    `${POSITION_SELECT} WHERE p.state <> 'closed' ORDER BY p.position_id`,
  );
  return result.rows.map(readRow);
}

/** The valuation a position's figures are computed from. */
export function valuationOf(row: PositionRow, assets: AssetStates): PositionValuation {
  return {
    collateral: row.collateral,
    debt: row.debt,
    collateralPrice: assets[row.collateralAsset].price.price,
    debtPrice: assets[row.debtAsset].price.price,
    collateralScale: assetScale(row.collateralAsset),
    debtScale: assetScale(row.debtAsset),
  };
}

export interface PositionFigures {
  readonly row: PositionRow;
  readonly healthFactorScaled: bigint | null;
  readonly liquidationPrice: bigint | null;
  readonly maxRepay: bigint;
}

/** The figures the server publishes for a position, at the current prices. */
export function positionFigures(row: PositionRow, assets: AssetStates): PositionFigures {
  const valuation = valuationOf(row, assets);
  const threshold = assets[row.collateralAsset].settings.liquidationThresholdBps;
  const bonus = assets[row.collateralAsset].settings.liquidationBonusBps;
  return {
    row,
    healthFactorScaled: healthFactorScaled(valuation, threshold),
    liquidationPrice: liquidationPrice(valuation, threshold),
    maxRepay: isLiquidatable(row.state) ? maxRepay(valuation, bonus) : 0n,
  };
}

/**
 * The state a position will read after this evaluation, without writing
 * anything. A settlement needs its `state_after` before it is written,
 * because `settlement.committed` is sequenced before `position.state_changed`.
 */
export function previewEvaluation(
  row: PositionRow,
  assets: AssetStates,
  nowMs: number,
): { readonly state: PositionState; readonly healthFactorScaled: bigint | null } {
  const valuation = valuationOf(row, assets);
  const health = healthFactorScaled(
    valuation,
    assets[row.collateralAsset].settings.liquidationThresholdBps,
  );
  const outcome = evaluatePosition({
    collateral: row.collateral,
    debt: row.debt,
    healthFactorScaled: health,
    storedGraceEndsAtMs: row.graceEndsAtMs,
    afterFillMark: row.afterFillMark,
    nowMs,
    graceSeconds: config.graceSeconds,
  });
  return { state: outcome.state, healthFactorScaled: health };
}

/**
 * Evaluates a position and persists the move. Emits one state-changed event
 * per change and queues one margin notice per arming. The caller holds the
 * position's row lock.
 */
export async function evaluateAndPersist(
  client: Queryable,
  row: PositionRow,
  assets: AssetStates,
  nowMs: number,
): Promise<PositionRow> {
  const valuation = valuationOf(row, assets);
  const collateralSettings = assets[row.collateralAsset].settings;
  const health = healthFactorScaled(valuation, collateralSettings.liquidationThresholdBps);

  const outcome = evaluatePosition({
    collateral: row.collateral,
    debt: row.debt,
    healthFactorScaled: health,
    storedGraceEndsAtMs: row.graceEndsAtMs,
    afterFillMark: row.afterFillMark,
    nowMs,
    graceSeconds: config.graceSeconds,
  });

  const leavingGraceAtItsEnd =
    row.state === 'liquidatable_grace' &&
    outcome.state !== 'liquidatable_grace' &&
    row.graceEndsAtMs !== null &&
    nowMs >= row.graceEndsAtMs;
  const occurredAtMs =
    leavingGraceAtItsEnd && row.graceEndsAtMs !== null ? row.graceEndsAtMs : nowMs;

  const queueNotice = queuesMarginNotice(outcome.state) && row.marginNoticeArmed;
  const armedAfter = outcome.rearmsMarginNotice
    ? true
    : queueNotice
      ? false
      : row.marginNoticeArmed;

  const unchanged =
    outcome.state === row.state &&
    outcome.graceEndsAtMs === row.graceEndsAtMs &&
    outcome.afterFillMark === row.afterFillMark &&
    armedAfter === row.marginNoticeArmed;
  if (unchanged) return row;

  await client.query(
    `UPDATE positions SET state = $1, grace_ends_at = $2, after_fill_mark = $3,
                          margin_notice_armed = $4
     WHERE position_id = $5`,
    [
      outcome.state,
      outcome.graceEndsAtMs === null ? null : writeInstant(outcome.graceEndsAtMs),
      outcome.afterFillMark,
      armedAfter,
      row.positionId,
    ],
  );

  if (queueNotice) {
    const recipient = await borrowerEmail(client, row.borrowerId);
    await queueMarginNotice(client, {
      positionId: row.positionId,
      recipient,
      healthFactorScaled: health,
      collateral: row.collateral,
      collateralAsset: row.collateralAsset,
      debt: row.debt,
      debtAsset: row.debtAsset,
      liquidationPrice: liquidationPrice(valuation, collateralSettings.liquidationThresholdBps),
      createdAtMs: nowMs,
    });
  }

  if (outcome.state !== row.state) {
    await emitPositionStateChanged(client, {
      positionId: row.positionId,
      from: row.state,
      to: outcome.state,
      healthFactorScaled: health,
      graceEndsAtMs: outcome.state === 'liquidatable_grace' ? outcome.graceEndsAtMs : null,
      occurredAtMs,
    });
  }

  return {
    ...row,
    state: outcome.state,
    graceEndsAtMs: outcome.graceEndsAtMs,
    afterFillMark: outcome.afterFillMark,
    marginNoticeArmed: armedAfter,
  };
}

export async function borrowerEmail(client: Queryable, actorId: string): Promise<string> {
  const result = await client.query<{ email: string }>(
    'SELECT email FROM actors WHERE actor_id = $1',
    [actorId],
  );
  const email = result.rows[0]?.email;
  if (email === undefined) throw new Error(`Unknown member ${actorId}`);
  return email;
}

/**
 * Evaluates every open position. Used by a price post, a risk save and the
 * background sweep, each of which re-evaluates the whole book.
 */
export async function evaluateAllOpenPositions(
  client: Queryable,
  assets: AssetStates,
  nowMs: number,
): Promise<PositionRow[]> {
  const rows = await listOpenPositions(client);
  const evaluated: PositionRow[] = [];
  for (const row of rows) {
    evaluated.push(await evaluateAndPersist(client, row, assets, nowMs));
  }
  return evaluated;
}

/** Counts the open positions, in any asset, whose health factor is below 1. */
export function countBelowHealthFactorOne(
  rows: readonly PositionRow[],
  assets: AssetStates,
): number {
  let count = 0;
  for (const row of rows) {
    const health = healthFactorScaled(
      valuationOf(row, assets),
      assets[row.collateralAsset].settings.liquidationThresholdBps,
    );
    if (health !== null && health < 10000n) count += 1;
  }
  return count;
}

/** Takes the next position id, continuing after the seeded ones. */
export async function nextPositionId(client: Queryable): Promise<string> {
  const result = await client.query<{ value: string }>(
    "SELECT nextval('position_ids')::text AS value",
  );
  const value = result.rows[0]?.value;
  if (value === undefined) throw new Error('Could not take a position id');
  return `pos-${value.padStart(4, '0')}`;
}
