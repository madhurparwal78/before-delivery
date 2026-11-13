/**
 * The published response objects. Every figure here comes from the server's
 * own reading of the ledger and the state machine.
 */

import type { Queryable } from '../db/pool.ts';
import { apiAmount, apiHealthFactor, apiPrice } from '../domain/apiformat.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { listNotices } from '../market/notices.ts';
import { positionFigures, type PositionRow } from '../market/positions.ts';
import type { AssetStates } from '../market/state.ts';
import {
  settlementCore,
  statementStatusOf,
  webhookStatusOf,
  type SettlementRecord,
} from '../market/settlements.ts';

export async function positionDto(
  client: Queryable,
  row: PositionRow,
  assets: AssetStates,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const figures = positionFigures(row, assets);
  const notices = await listNotices(client, row.positionId);
  return {
    position_id: row.positionId,
    borrower_id: row.borrowerId,
    collateral_asset: row.collateralAsset,
    debt_asset: row.debtAsset,
    collateral_amount: apiAmount(row.collateral),
    debt: apiAmount(row.debt),
    health_factor: apiHealthFactor(figures.healthFactorScaled),
    liquidation_price:
      figures.liquidationPrice === null ? null : apiPrice(figures.liquidationPrice),
    state: row.state,
    // non-null only while the state is liquidatable_grace
    grace_ends_at:
      row.state === 'liquidatable_grace' && row.graceEndsAtMs !== null
        ? formatCanonicalUtc(row.graceEndsAtMs)
        : null,
    round: row.round,
    max_repay: apiAmount(figures.maxRepay),
    notices: notices.map((notice) => ({
      notice_id: notice.noticeId,
      kind: notice.kind,
      status: notice.status,
      created_at: formatCanonicalUtc(notice.createdAtMs),
      sent_at: notice.sentAtMs === null ? null : formatCanonicalUtc(notice.sentAtMs),
    })),
    created_at: formatCanonicalUtc(row.createdAtMs),
    server_time: formatCanonicalUtc(nowMs),
  };
}

export async function positionDtos(
  client: Queryable,
  rows: readonly PositionRow[],
  assets: AssetStates,
  nowMs: number,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    out.push(await positionDto(client, row, assets, nowMs));
  }
  return out;
}

/**
 * The settlement, with its statement, notice and webhook statuses determined
 * at the time of asking.
 */
export async function settlementDto(
  client: Queryable,
  record: SettlementRecord,
): Promise<Record<string, unknown>> {
  const core = settlementCore(record);
  const [statementStatus, webhookStatus] = await Promise.all([
    statementStatusOf(record),
    webhookStatusOf(client, record),
  ]);
  const dto: Record<string, unknown> = {
    ...core,
    pdf_rendered_at:
      record.pdfRenderedAtMs === null ? null : formatCanonicalUtc(record.pdfRenderedAtMs),
    statement_status: statementStatus,
    webhook_status: webhookStatus,
  };
  if (record.kind === 'liquidation') {
    const notice = await client.query<{ status: string }>(
      "SELECT status FROM notices WHERE settlement_id = $1 AND kind = 'liquidation' LIMIT 1",
      [record.settlementId],
    );
    dto['notice_status'] = notice.rows[0]?.status === 'sent' ? 'sent' : 'queued';
  }
  return dto;
}
