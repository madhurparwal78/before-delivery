import type { Tx } from './db.js';
import type { AssetCode, PositionState } from '../shared/types.js';
import { getConfig } from './config.js';
import { healthFactorScaled, liquidationPrice } from './domain.js';
import { enqueueEvent } from './outbox.js';
import { noticesFor } from './positions.js';

export interface PositionRow {
  position_id: string;
  borrower_id: string;
  collateral_asset: AssetCode;
  debt_asset: AssetCode;
  collateral_amount: string;
  debt: string;
  posted_debt: string;
  principal: string;
  reference_index: string;
  state: PositionState;
  grace_ends_at: string | null;
  after_fill_mark: boolean;
  margin_armed: boolean;
  round: string;
  created_at: Date;
  updated_at: Date;
}

export interface PriceRow {
  asset: AssetCode;
  price: string;
  posted_at: Date;
}

export interface EvalContext {
  collateralPrice: bigint;
  debtPrice: bigint;
  thresholdBps: number;
  graceSeconds: number;
  nowSec: number;
}

export interface EvalResult {
  state: PositionState;
  grace_ends_at: string | null;
  marginNotice: boolean;
  hfScaled: bigint | null;
  liqPrice: bigint | null;
}

function sameState(a: PositionState, b: PositionState): boolean {
  return a === b;
}

/**
 * Evaluate a position by the rules, returning the target state, grace end,
 * whether a margin notice must be queued and the current figures.
 * The caller applies the result and emits events for changes.
 */
export function evaluatePosition(row: PositionRow, ctx: EvalContext): EvalResult {
  const collateral = BigInt(row.collateral_amount);
  const debt = BigInt(row.posted_debt);
  const hfScaled = healthFactorScaled({
    collateralAsset: row.collateral_asset,
    debtAsset: row.debt_asset,
    collateral_amount: collateral,
    collateral_price: ctx.collateralPrice,
    debt,
    debt_price: ctx.debtPrice,
    liquidation_threshold_bps: ctx.thresholdBps,
  });
  const liqPrice = debt === 0n ? null : liquidationPrice({
    collateralAsset: row.collateral_asset,
    debtAsset: row.debt_asset,
    collateral_amount: collateral,
    collateral_price: ctx.collateralPrice,
    debt,
    debt_price: ctx.debtPrice,
    liquidation_threshold_bps: ctx.thresholdBps,
  });
  if (collateral === 0n && debt === 0n) {
    return { state: 'closed', grace_ends_at: null, marginNotice: false, hfScaled: null, liqPrice: null };
  }
  const warningNum = 11_000n;
  if (hfScaled === null || hfScaled >= warningNum) {
    return { state: 'healthy', grace_ends_at: null, marginNotice: false, hfScaled, liqPrice };
  }
  if (hfScaled >= 10_000n) {
    return { state: 'warned', grace_ends_at: null, marginNotice: true, hfScaled, liqPrice };
  }
  const storedGrace = row.grace_ends_at === null ? null : BigInt(row.grace_ends_at);
  if (storedGrace === null) {
    return {
      state: 'liquidatable_grace',
      grace_ends_at: BigInt(ctx.nowSec + ctx.graceSeconds).toString(),
      marginNotice: true,
      hfScaled,
      liqPrice,
    };
  }
  if (BigInt(ctx.nowSec) < storedGrace) {
    return { state: 'liquidatable_grace', grace_ends_at: storedGrace.toString(), marginNotice: false, hfScaled, liqPrice };
  }
  return {
    state: row.after_fill_mark ? 'partially_liquidated' : 'liquidatable',
    grace_ends_at: storedGrace.toString(),
    marginNotice: false,
    hfScaled,
    liqPrice,
  };
}

/** Whether a margin notice must be armed again after leaving the danger zone. */
export function clearsNotice(result: EvalResult): boolean {
  return result.state === 'healthy';
}

export interface ApplyEval {
  stateChanged: boolean;
  from: PositionState | null;
  to: PositionState;
}

/** Apply an evaluation: persist state, grace end and margin arming, emit events. */
export async function applyEvaluation(
  tx: Tx,
  row: PositionRow,
  result: EvalResult,
  occurredAt: Date,
  keepMark: boolean,
): Promise<void> {
  const previous = row.state;
  const changed = !sameState(previous, result.state);
  const graceChanged = row.grace_ends_at !== result.grace_ends_at;
  if (changed || graceChanged) {
    await tx.query(
      `UPDATE positions SET state = $1, grace_ends_at = $2, updated_at = now() WHERE position_id = $3`,
      [result.state, result.grace_ends_at, row.position_id],
    );
  }
  if (result.state === 'healthy') {
    if (!row.margin_armed || changed || graceChanged) {
      await tx.query(
        'UPDATE positions SET margin_armed = true, updated_at = now() WHERE position_id = $1',
        [row.position_id],
      );
    }
  }
  if (changed) {
    const sequenceRow = await tx.query<{ last_sequence: string }>(
      'SELECT last_sequence FROM position_sequences WHERE position_id = $1 FOR UPDATE',
      [row.position_id],
    );
    let last = 0n;
    if (sequenceRow.rows.length === 0) {
      await tx.query('INSERT INTO position_sequences (position_id, last_sequence) VALUES ($1, 0)', [row.position_id]);
    } else {
      last = BigInt(sequenceRow.rows[0].last_sequence);
    }
    const sequence = last + 1n;
    await tx.query('UPDATE position_sequences SET last_sequence = $1 WHERE position_id = $2', [sequence.toString(), row.position_id]);
    await enqueueEvent(tx, {
      event_id: crypto.randomUUID(),
      type: 'position.state_changed',
      position_id: row.position_id,
      sequence: Number(sequence),
      occurred_at: canonical(occurredAt),
      data: {
        from: previous === undefined ? null : previous,
        to: result.state,
        health_factor: result.hfScaled === null ? null : hfApi(result.hfScaled),
        grace_ends_at: result.grace_ends_at === null ? null : canonical(new Date(Number(result.grace_ends_at) * 1000)),
      },
    });
  }
  if (!keepMark && result.state === 'healthy') {
    await tx.query('UPDATE positions SET after_fill_mark = false WHERE position_id = $1', [row.position_id]);
  }
  if (result.marginNotice && row.margin_armed) {
    await noticesFor(tx, row.position_id, 'margin', occurredAt);
    await tx.query('UPDATE positions SET margin_armed = false WHERE position_id = $1', [row.position_id]);
  }
  void getConfig;
  void keepMark;
}

export function canonical(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function hfApi(scaled: bigint): string {
  const base = scaled.toString().padStart(5, '0');
  return `${base.slice(0, base.length - 4)}.${base.slice(base.length - 4)}`;
}
