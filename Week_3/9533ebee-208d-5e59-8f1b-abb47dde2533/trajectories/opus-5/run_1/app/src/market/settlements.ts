/**
 * Settlements. A draw, liquidity withdrawal or liquidation commits its
 * posting, its statement objects, its integrator event and (for a
 * liquidation) its queued borrower notice together or not at all. If storing
 * an object fails, nothing commits and any object already written is removed.
 */

import { randomUUID } from 'node:crypto';
import {
  readBig,
  readBigOrNull,
  readInstant,
  readInstantOrNull,
  writeInstant,
  type Queryable,
} from '../db/pool.ts';
import { apiAmount, apiHealthFactor, apiPrice, apiSharePrice } from '../domain/apiformat.ts';
import type { Asset } from '../domain/assets.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import type { PositionState } from '../domain/position.ts';
import { statementStoreUnavailable } from '../http/problem.ts';
import type { Leg } from '../ledger/postings.ts';
import { deleteObject, objectExists, putObject, StorageUnreachable } from '../services/s3.ts';
import { emitSettlementCommitted } from './events.ts';
import {
  statementHtml,
  statementJsonKey,
  statementPdfKey,
  statementText,
  statementTextKey,
  type LiquidationStatementFigures,
  type SettlementKind,
} from './statements.ts';

export type StatementStatus = 'stored' | 'pending_statement';
export type WebhookStatus = 'queued' | 'delivered';

export interface DrawFigures {
  readonly debtAfter: bigint;
  readonly healthFactorAfterScaled: bigint | null;
  readonly stateAfter: PositionState;
}

export interface WithdrawalFigures {
  readonly sharesBurned: bigint;
  readonly sharePriceAfterScaled: bigint;
}

export interface LiquidationFigures extends LiquidationStatementFigures {
  readonly round: number;
  readonly borrowerId: string;
  readonly stateAfter: PositionState;
  readonly priceCollateral: bigint;
  readonly priceDebt: bigint;
}

export interface SettlementDraft {
  readonly kind: SettlementKind;
  readonly actorId: string;
  readonly memberName: string;
  readonly positionId: string | null;
  readonly asset: Asset;
  readonly amount: bigint;
  readonly postingId: string;
  readonly legs: readonly Leg[];
  readonly createdAtMs: number;
  readonly draw: DrawFigures | null;
  readonly withdrawal: WithdrawalFigures | null;
  readonly liquidation: LiquidationFigures | null;
}

export interface SettlementRecord {
  readonly settlementId: string;
  readonly kind: SettlementKind;
  readonly actorId: string;
  readonly positionId: string | null;
  readonly asset: Asset;
  readonly amount: bigint;
  readonly postingId: string;
  readonly statementKey: string;
  readonly textStatementKey: string;
  readonly pdfKey: string;
  readonly pdfRenderedAtMs: number | null;
  readonly eventId: string;
  readonly createdAtMs: number;
  readonly legs: readonly Leg[];
  readonly draw: DrawFigures | null;
  readonly withdrawal: WithdrawalFigures | null;
  readonly liquidation: LiquidationFigures | null;
}

/**
 * The settlement as the API publishes it, without the four fields that are
 * determined at the time of asking. This object is exactly the statement JSON.
 */
export function settlementCore(record: SettlementRecord): Record<string, unknown> {
  const core: Record<string, unknown> = {
    settlement_id: record.settlementId,
    kind: record.kind,
    actor_id: record.actorId,
    position_id: record.positionId,
    asset: record.asset,
    amount: apiAmount(record.amount),
    legs: record.legs.map((leg) => ({
      account: leg.account,
      asset: leg.asset,
      amount: apiAmount(leg.amount),
    })),
    statement_key: record.statementKey,
    pdf_key: record.pdfKey,
    event_id: record.eventId,
    created_at: formatCanonicalUtc(record.createdAtMs),
  };

  if (record.draw !== null) {
    core['debt_after'] = apiAmount(record.draw.debtAfter);
    core['health_factor_after'] = apiHealthFactor(record.draw.healthFactorAfterScaled);
    core['state_after'] = record.draw.stateAfter;
  }
  if (record.withdrawal !== null) {
    core['shares_burned'] = apiAmount(record.withdrawal.sharesBurned);
    core['share_price_after'] = apiSharePrice(record.withdrawal.sharePriceAfterScaled);
  }
  const fill = record.liquidation;
  if (fill !== null) {
    core['round'] = fill.round;
    core['borrower_id'] = fill.borrowerId;
    core['repaid'] = apiAmount(fill.repaid);
    core['seized'] = apiAmount(fill.seized);
    core['bonus_amount'] = apiAmount(fill.bonusAmount);
    core['written_off'] = apiAmount(fill.writtenOff);
    core['health_factor_before'] = apiHealthFactor(fill.healthFactorBeforeScaled);
    core['health_factor_after'] = apiHealthFactor(fill.healthFactorAfterScaled);
    core['state_after'] = fill.stateAfter;
    core['price_collateral'] = apiPrice(fill.priceCollateral);
    core['price_debt'] = apiPrice(fill.priceDebt);
  }
  return core;
}

function statementInputOf(record: SettlementRecord, memberName: string) {
  return {
    settlementId: record.settlementId,
    kind: record.kind,
    memberName,
    actorId: record.actorId,
    asset: record.asset,
    amount: record.amount,
    createdAtMs: record.createdAtMs,
    legs: record.legs,
    liquidation: record.liquidation,
  };
}

/** The statement HTML the render queue hands to the renderer. */
export function settlementHtml(record: SettlementRecord, memberName: string): string {
  return statementHtml(statementInputOf(record, memberName));
}

/**
 * Writes the settlement, its two statement objects, its render queue entry
 * and its `settlement.committed` event. Called inside the caller's
 * transaction, which rolls back if any object cannot be stored.
 */
export async function createSettlement(
  client: Queryable,
  draft: SettlementDraft,
): Promise<SettlementRecord> {
  const settlementId = randomUUID();
  const eventId = randomUUID();
  const record: SettlementRecord = {
    settlementId,
    kind: draft.kind,
    actorId: draft.actorId,
    positionId: draft.positionId,
    asset: draft.asset,
    amount: draft.amount,
    postingId: draft.postingId,
    statementKey: statementJsonKey(draft.kind, settlementId),
    textStatementKey: statementTextKey(draft.kind, settlementId),
    pdfKey: statementPdfKey(draft.kind, settlementId),
    pdfRenderedAtMs: null,
    eventId,
    createdAtMs: draft.createdAtMs,
    legs: draft.legs,
    draw: draft.draw,
    withdrawal: draft.withdrawal,
    liquidation: draft.liquidation,
  };

  const createdAt = writeInstant(draft.createdAtMs);
  const fill = draft.liquidation;
  await client.query(
    `INSERT INTO settlements (
       settlement_id, kind, actor_id, position_id, asset, amount, posting_id,
       statement_key, text_statement_key, pdf_key, pdf_rendered_at, event_id, created_at,
       debt_after, health_factor_after, state_after,
       shares_burned, share_price_after,
       round, borrower_id, repaid, seized, bonus_amount, written_off,
       health_factor_before, price_collateral, price_debt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,
             $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [
      settlementId,
      draft.kind,
      draft.actorId,
      draft.positionId,
      draft.asset,
      draft.amount.toString(),
      draft.postingId,
      record.statementKey,
      record.textStatementKey,
      record.pdfKey,
      eventId,
      createdAt,
      draft.draw === null ? null : draft.draw.debtAfter.toString(),
      draft.draw?.healthFactorAfterScaled?.toString() ??
        fill?.healthFactorAfterScaled?.toString() ??
        null,
      draft.draw?.stateAfter ?? fill?.stateAfter ?? null,
      draft.withdrawal === null ? null : draft.withdrawal.sharesBurned.toString(),
      draft.withdrawal === null ? null : draft.withdrawal.sharePriceAfterScaled.toString(),
      fill === null ? null : fill.round,
      fill === null ? null : fill.borrowerId,
      fill === null ? null : fill.repaid.toString(),
      fill === null ? null : fill.seized.toString(),
      fill === null ? null : fill.bonusAmount.toString(),
      fill === null ? null : fill.writtenOff.toString(),
      fill?.healthFactorBeforeScaled?.toString() ?? null,
      fill === null ? null : fill.priceCollateral.toString(),
      fill === null ? null : fill.priceDebt.toString(),
    ],
  );

  // The statement objects are written before the transaction commits.
  const written: string[] = [];
  try {
    await putObject(
      record.statementKey,
      JSON.stringify(settlementCore(record)),
      'application/json',
    );
    written.push(record.statementKey);
    await putObject(
      record.textStatementKey,
      statementText(statementInputOf(record, draft.memberName)),
      'text/plain; charset=utf-8',
    );
    written.push(record.textStatementKey);
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      for (const key of written) {
        try {
          await deleteObject(key);
        } catch {
          // the store is unreachable; the orphan is never referenced
        }
      }
      throw statementStoreUnavailable();
    }
    throw error;
  }

  await client.query(
    `INSERT INTO pdf_renders (settlement_id, status, attempts, next_attempt_at, created_at)
     VALUES ($1, 'queued', 0, $2, $2)`,
    [settlementId, createdAt],
  );

  await emitSettlementCommitted(client, {
    eventId,
    settlementId,
    kind: draft.kind,
    asset: draft.asset,
    amount: draft.amount,
    statementKey: record.statementKey,
    positionId: draft.positionId,
    occurredAtMs: draft.createdAtMs,
  });

  return record;
}

interface SettlementQueryRow {
  settlement_id: string;
  kind: string;
  actor_id: string;
  position_id: string | null;
  asset: string;
  amount: string;
  posting_id: string;
  statement_key: string;
  text_statement_key: string;
  pdf_key: string;
  pdf_rendered_at: Date | null;
  event_id: string;
  created_at: Date;
  debt_after: string | null;
  health_factor_after: string | null;
  state_after: string | null;
  shares_burned: string | null;
  share_price_after: string | null;
  round: number | null;
  borrower_id: string | null;
  repaid: string | null;
  seized: string | null;
  bonus_amount: string | null;
  written_off: string | null;
  health_factor_before: string | null;
  price_collateral: string | null;
  price_debt: string | null;
  collateral_asset: string | null;
  debt_asset: string | null;
  legs: Array<{ account: string; asset: string; amount: string }>;
}

const SETTLEMENT_SELECT = `
  SELECT s.*, pos.collateral_asset, pos.debt_asset,
         (SELECT json_agg(json_build_object('account', l.account, 'asset', l.asset,
                                            'amount', l.amount::text) ORDER BY l.leg_index)
          FROM ledger_legs l WHERE l.posting_id = s.posting_id) AS legs
  FROM settlements s
  LEFT JOIN positions pos ON pos.position_id = s.position_id`;

function readSettlementRow(row: SettlementQueryRow): SettlementRecord {
  const kind = row.kind as SettlementKind;
  const draw =
    kind === 'draw'
      ? {
          debtAfter: readBig(row.debt_after),
          healthFactorAfterScaled: readBigOrNull(row.health_factor_after),
          stateAfter: (row.state_after ?? 'healthy') as PositionState,
        }
      : null;
  const withdrawal =
    kind === 'withdrawal'
      ? {
          sharesBurned: readBig(row.shares_burned),
          sharePriceAfterScaled: readBig(row.share_price_after),
        }
      : null;
  const liquidation =
    kind === 'liquidation'
      ? {
          round: row.round ?? 0,
          borrowerId: row.borrower_id ?? '',
          repaid: readBig(row.repaid),
          seized: readBig(row.seized),
          bonusAmount: readBig(row.bonus_amount),
          writtenOff: readBig(row.written_off),
          healthFactorBeforeScaled: readBigOrNull(row.health_factor_before),
          healthFactorAfterScaled: readBigOrNull(row.health_factor_after),
          stateAfter: (row.state_after ?? 'closed') as PositionState,
          priceCollateral: readBig(row.price_collateral),
          priceDebt: readBig(row.price_debt),
          collateralAsset: (row.collateral_asset ?? row.asset) as Asset,
          debtAsset: (row.debt_asset ?? row.asset) as Asset,
        }
      : null;
  return {
    settlementId: row.settlement_id,
    kind,
    actorId: row.actor_id,
    positionId: row.position_id,
    asset: row.asset as Asset,
    amount: readBig(row.amount),
    postingId: row.posting_id,
    statementKey: row.statement_key,
    textStatementKey: row.text_statement_key,
    pdfKey: row.pdf_key,
    pdfRenderedAtMs: readInstantOrNull(row.pdf_rendered_at),
    eventId: row.event_id,
    createdAtMs: readInstant(row.created_at),
    legs: (row.legs ?? []).map((leg) => ({
      account: leg.account,
      asset: leg.asset as Asset,
      amount: readBig(leg.amount),
    })),
    draw,
    withdrawal,
    liquidation,
  };
}

export async function loadSettlement(
  client: Queryable,
  settlementId: string,
): Promise<SettlementRecord | null> {
  const result = await client.query<SettlementQueryRow>(
    `${SETTLEMENT_SELECT} WHERE s.settlement_id = $1`,
    [settlementId],
  );
  const row = result.rows[0];
  return row === undefined ? null : readSettlementRow(row);
}

/**
 * A settlement reads `stored` only when the server's check at the time of
 * asking finds both its statement JSON and its PDF in storage. A store that
 * is unreachable leaves it pending.
 */
export async function statementStatusOf(record: SettlementRecord): Promise<StatementStatus> {
  if (record.pdfRenderedAtMs === null) return 'pending_statement';
  try {
    const [json, pdf] = await Promise.all([
      objectExists(record.statementKey),
      objectExists(record.pdfKey),
    ]);
    return json && pdf ? 'stored' : 'pending_statement';
  } catch {
    return 'pending_statement';
  }
}

export async function webhookStatusOf(
  client: Queryable,
  record: SettlementRecord,
): Promise<WebhookStatus> {
  const result = await client.query<{ status: string }>(
    'SELECT status FROM outbox_events WHERE event_id = $1',
    [record.eventId],
  );
  return result.rows[0]?.status === 'delivered' ? 'delivered' : 'queued';
}

/** Marks a PDF stored. `pdf_rendered_at` never changes once set. */
export async function markPdfRendered(
  client: Queryable,
  settlementId: string,
  renderedAtMs: number,
): Promise<void> {
  await client.query(
    'UPDATE settlements SET pdf_rendered_at = $1 WHERE settlement_id = $2 AND pdf_rendered_at IS NULL',
    [writeInstant(renderedAtMs), settlementId],
  );
}
