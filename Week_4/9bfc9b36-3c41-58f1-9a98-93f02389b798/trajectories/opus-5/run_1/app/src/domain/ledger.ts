import type { Transaction } from '../db/pool';
import { inches, squareFeet, squareMetres } from '../shared/units';
import { nextLedgerLineId, opaqueId } from './records';
import { instantOf, type Reader } from './model';

/**
 * The one place that pairs the cloth ledger. Every cloth movement posts two
 * lines with one pair id and one instant, whose amounts sum to zero.
 */

export const LEDGER_REASONS = {
  rollReceived: 'Received, full roll',
  openingCount: 'Opening count',
  panelsCut: 'Panels cut',
  waste: 'Waste',
  offcutReceived: 'Offcut received',
} as const;

export const COUNTER_ACCOUNTS = {
  supplierReceipt: 'supplier-receipt',
  openingStock: 'opening-stock',
  importedHistory: 'imported-history',
  waste: 'waste',
  countAdjustment: 'count-adjustment',
} as const;

export function panelsAccount(drawingCode: string): string {
  return `panels ${drawingCode}`;
}

export interface PairRequest {
  /** The stock item whose cloth moves, and the sign of its line. */
  readonly stockCode: string;
  readonly stockAmountMm2: number;
  readonly counterAccount: string;
  /** Only the offcut-receipt pair carries a different stock code on its counter line. */
  readonly counterStockCode?: string;
  readonly drawingCode?: string;
  readonly actorEmail: string;
  readonly reason: string;
}

export interface PostedLine {
  readonly line_id: number;
  readonly pair_id: string;
  readonly posted_at: string;
  readonly account: string;
  readonly amount_mm2: number;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly actor_email: string;
  readonly reason: string;
}

export interface PostedPair {
  readonly pair_id: string;
  readonly lines: readonly [PostedLine, PostedLine];
}

/** Posts one balanced pair and keeps the stored on-hand equal to the ledger. */
export async function postPair(tx: Transaction, at: Date, request: PairRequest): Promise<PostedPair> {
  const pairId = opaqueId('PR-');
  const postedAt = instantOf(at);
  const stockLineId = await nextLedgerLineId(tx);
  const counterLineId = await nextLedgerLineId(tx);
  const drawingCode = request.drawingCode ?? '';

  const stockLine: PostedLine = {
    line_id: stockLineId,
    pair_id: pairId,
    posted_at: postedAt,
    account: request.stockCode,
    amount_mm2: request.stockAmountMm2,
    stock_code: request.stockCode,
    drawing_code: drawingCode,
    actor_email: request.actorEmail,
    reason: request.reason,
  };
  const counterLine: PostedLine = {
    line_id: counterLineId,
    pair_id: pairId,
    posted_at: postedAt,
    account: request.counterAccount,
    amount_mm2: -request.stockAmountMm2,
    stock_code: request.counterStockCode ?? request.stockCode,
    drawing_code: drawingCode,
    actor_email: request.actorEmail,
    reason: request.reason,
  };

  for (const line of [stockLine, counterLine]) {
    await tx.query(
      `INSERT INTO ledger_line (line_id, pair_id, posted_at, account, amount_mm2, stock_code,
         drawing_code, actor_email, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [line.line_id, line.pair_id, line.posted_at, line.account, line.amount_mm2, line.stock_code,
        line.drawing_code, line.actor_email, line.reason],
    );
  }

  // The stored on-hand of every stock account named by the pair follows its lines.
  await tx.query('UPDATE stock SET on_hand_mm2 = on_hand_mm2 + $2 WHERE code = $1', [
    request.stockCode,
    request.stockAmountMm2,
  ]);
  if (request.counterStockCode !== undefined && request.counterAccount !== request.stockCode) {
    await tx.query('UPDATE stock SET on_hand_mm2 = on_hand_mm2 + $2 WHERE code = $1', [
      request.counterAccount,
      -request.stockAmountMm2,
    ]);
  }
  return { pair_id: pairId, lines: [stockLine, counterLine] };
}

export interface LedgerFooter {
  readonly stock_code: string | null;
  readonly remaining_mm: number | null;
  readonly remaining_in: string | null;
  readonly offcut_count: number;
  readonly on_hand_mm2: number;
  readonly on_hand_m2: string;
  readonly on_hand_ft2: string;
  readonly lines: number;
}

/** Every total covers every ledger line, never a page. */
export async function ledgerFooter(db: Reader, stockCode: string | null): Promise<LedgerFooter> {
  const offcuts = await db.one<{ n: string }>(
    `SELECT count(*)::text n FROM stock WHERE kind = 'offcut' AND remaining_mm > 0`,
  );
  const offcutCount = Number(offcuts?.n ?? '0');
  if (stockCode === null) {
    const all = await db.one<{ on_hand: string; lines: string }>(
      `SELECT coalesce(sum(on_hand_mm2),0)::text on_hand,
              (SELECT count(*) FROM ledger_line)::text lines FROM stock`,
    );
    const onHand = Number(all?.on_hand ?? '0');
    return {
      stock_code: null,
      remaining_mm: null,
      remaining_in: null,
      offcut_count: offcutCount,
      on_hand_mm2: onHand,
      on_hand_m2: squareMetres(onHand),
      on_hand_ft2: squareFeet(onHand),
      lines: Number(all?.lines ?? '0'),
    };
  }
  const item = await db.one<{ remaining_mm: number; on_hand_mm2: string }>(
    'SELECT remaining_mm, on_hand_mm2 FROM stock WHERE code = $1',
    [stockCode],
  );
  const count = await db.one<{ n: string }>(
    'SELECT count(*)::text n FROM ledger_line WHERE stock_code = $1',
    [stockCode],
  );
  const onHand = Number(item?.on_hand_mm2 ?? '0');
  return {
    stock_code: stockCode,
    remaining_mm: item?.remaining_mm ?? 0,
    remaining_in: inches(item?.remaining_mm ?? 0),
    offcut_count: offcutCount,
    on_hand_mm2: onHand,
    on_hand_m2: squareMetres(onHand),
    on_hand_ft2: squareFeet(onHand),
    lines: Number(count?.n ?? '0'),
  };
}

export function ledgerLineView(row: {
  line_id: string;
  pair_id: string;
  posted_at: Date;
  account: string;
  amount_mm2: string;
  stock_code: string;
  drawing_code: string;
  actor_email: string;
  reason: string;
}): PostedLine {
  return {
    line_id: Number(row.line_id),
    pair_id: row.pair_id,
    posted_at: instantOf(row.posted_at),
    account: row.account,
    amount_mm2: Number(row.amount_mm2),
    stock_code: row.stock_code,
    drawing_code: row.drawing_code,
    actor_email: row.actor_email,
    reason: row.reason,
  };
}
