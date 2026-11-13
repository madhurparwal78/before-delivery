/**
 * Margin and liquidation notices. Each is queued in the same transaction as
 * the change that caused it, with its figures already written in desk format,
 * and reads `sent` only after the mail server has accepted it.
 */

import { randomUUID } from 'node:crypto';
import { writeInstant, type Queryable } from '../db/pool.ts';
import { assetDecimals, type Asset } from '../domain/assets.ts';
import { formatAmount, formatHealthFactor, formatPrice } from '../domain/deskformat.ts';
import { apiHealthFactor } from '../domain/apiformat.ts';

export type NoticeKind = 'margin' | 'liquidation';
export type NoticeStatus = 'queued' | 'sent';

interface QueueInput {
  readonly positionId: string;
  readonly kind: NoticeKind;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly settlementId: string | null;
  readonly createdAtMs: number;
}

async function queueNotice(client: Queryable, input: QueueInput): Promise<string> {
  const noticeId = randomUUID();
  const createdAt = writeInstant(input.createdAtMs);
  await client.query(
    `INSERT INTO notices (notice_id, position_id, settlement_id, kind, status, recipient,
                          subject, body, attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, 0, $8, $8)`,
    [
      noticeId,
      input.positionId,
      input.settlementId,
      input.kind,
      input.recipient,
      input.subject,
      input.body,
      createdAt,
    ],
  );
  return noticeId;
}

export interface MarginNoticeInput {
  readonly positionId: string;
  readonly recipient: string;
  readonly healthFactorScaled: bigint | null;
  readonly collateral: bigint;
  readonly collateralAsset: Asset;
  readonly debt: bigint;
  readonly debtAsset: Asset;
  readonly liquidationPrice: bigint | null;
  readonly createdAtMs: number;
}

export async function queueMarginNotice(
  client: Queryable,
  input: MarginNoticeInput,
): Promise<string> {
  const health = formatHealthFactor(apiHealthFactor(input.healthFactorScaled));
  const body = [
    `Debt ${formatAmount(input.debt, assetDecimals(input.debtAsset))} ${input.debtAsset}`,
    `Collateral ${formatAmount(input.collateral, assetDecimals(input.collateralAsset))} ${input.collateralAsset}`,
    `Liquidation price ${input.liquidationPrice === null ? 'No debt' : formatPrice(input.liquidationPrice)}`,
    '',
    'Repay or add collateral to stay above health factor 1.',
  ].join('\n');
  return queueNotice(client, {
    positionId: input.positionId,
    kind: 'margin',
    recipient: input.recipient,
    subject: `Margin notice: ${input.positionId} at health factor ${health}`,
    body,
    settlementId: null,
    createdAtMs: input.createdAtMs,
  });
}

export interface LiquidationNoticeInput {
  readonly positionId: string;
  readonly recipient: string;
  readonly round: number;
  readonly repaid: bigint;
  readonly debtAsset: Asset;
  readonly seized: bigint;
  readonly bonusAmount: bigint;
  readonly collateralAsset: Asset;
  readonly healthFactorAfterScaled: bigint | null;
  readonly settlementId: string;
  readonly createdAtMs: number;
}

export async function queueLiquidationNotice(
  client: Queryable,
  input: LiquidationNoticeInput,
): Promise<string> {
  const collateralDecimals = assetDecimals(input.collateralAsset);
  const body = [
    `Repaid ${formatAmount(input.repaid, assetDecimals(input.debtAsset))} ${input.debtAsset}`,
    `Seized ${formatAmount(input.seized, collateralDecimals)} ${input.collateralAsset}`,
    `Bonus ${formatAmount(input.bonusAmount, collateralDecimals)} ${input.collateralAsset}`,
    `Health factor after ${formatHealthFactor(apiHealthFactor(input.healthFactorAfterScaled))}`,
    `Settlement ${input.settlementId}`,
  ].join('\n');
  return queueNotice(client, {
    positionId: input.positionId,
    kind: 'liquidation',
    recipient: input.recipient,
    subject: `Liquidation notice: ${input.positionId} fill ${input.round}`,
    body,
    settlementId: input.settlementId,
    createdAtMs: input.createdAtMs,
  });
}

export interface NoticeRecord {
  readonly noticeId: string;
  readonly kind: NoticeKind;
  readonly status: NoticeStatus;
  readonly createdAtMs: number;
  readonly sentAtMs: number | null;
}

export async function listNotices(
  client: Queryable,
  positionId: string,
): Promise<NoticeRecord[]> {
  const result = await client.query<{
    notice_id: string;
    kind: string;
    status: string;
    created_at: Date;
    sent_at: Date | null;
  }>(
    `SELECT notice_id, kind, status, created_at, sent_at FROM notices
     WHERE position_id = $1 ORDER BY created_at, notice_id`,
    [positionId],
  );
  return result.rows.map((row) => ({
    noticeId: row.notice_id,
    kind: row.kind as NoticeKind,
    status: row.status as NoticeStatus,
    createdAtMs: row.created_at.getTime(),
    sentAtMs: row.sent_at === null ? null : row.sent_at.getTime(),
  }));
}
