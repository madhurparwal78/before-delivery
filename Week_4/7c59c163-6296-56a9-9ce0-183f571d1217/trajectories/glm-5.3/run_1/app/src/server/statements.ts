import PDFDocument from 'pdfkit';
import { formatMoney, monthName } from './money.js';
import type { Pool } from './db.js';

export interface StatementInput {
  venueName: string;
  memberName: string;
  month: string;
  openingCents: number;
  closingCents: number;
  deposits: { id: string; amount_cents: number; created_at: Date }[];
  refunds: { id: string; amount_cents: number; created_at: Date }[];
  fills: { symbol: string; mode: string | null; outcome: string | null; side: string; price: number; quantity: number; fee_cents: number; kind: 'pair' | 'event'; created_at: Date }[];
  payouts: { market_id: string; amount_cents: number; created_at: Date }[];
  nettings: { market_id: string; amount_cents: number; created_at: Date }[];
  liquidations: { market_id: string; amount_cents: number; created_at: Date }[];
}

export interface StatementRow {
  id: string;
  venue_id: string;
  member_id: string;
  month: string;
  created_at: Date;
}

export async function renderStatementPdf(input: StatementInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).font('Helvetica-Bold').text(`${input.venueName} — Statement`);
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica').text(`Member: ${input.memberName}`);
  doc.text(`Month: ${monthName(input.month)}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(13).text('Balances');
  doc.font('Helvetica').fontSize(11);
  doc.text(`Opening total balance: ${formatMoney(input.openingCents)}`);
  doc.text(`Closing total balance: ${formatMoney(input.closingCents)}`);
  doc.moveDown(1);

  section(doc, 'Deposits', input.deposits.map((d) => `${d.created_at.toISOString().slice(0, 10)}  ${formatMoney(d.amount_cents)}  (${d.id})`));
  section(doc, 'Refunds', input.refunds.map((r) => `${r.created_at.toISOString().slice(0, 10)}  ${formatMoney(r.amount_cents)}  (${r.id})`));
  section(doc, 'Fills', input.fills.map((f) => `${f.created_at.toISOString().slice(0, 10)}  ${f.symbol} ${label(f)} ${f.side} ${f.kind === 'event' ? `${f.price}c` : formatMoney(f.price)} x ${f.quantity} fee ${formatMoney(f.fee_cents)}`));
  section(doc, 'Payouts', input.payouts.map((p) => `${p.created_at.toISOString().slice(0, 10)}  ${formatMoney(p.amount_cents)}  (${p.market_id})`));
  section(doc, 'Netting', input.nettings.map((n) => `${n.created_at.toISOString().slice(0, 10)}  ${formatMoney(n.amount_cents)}  (${n.market_id})`));
  section(doc, 'Liquidations', input.liquidations.map((l) => `${l.created_at.toISOString().slice(0, 10)}  ${formatMoney(l.amount_cents)}  (${l.market_id})`));

  doc.end();
  return done;
}

function section(doc: PDFKit.PDFDocument, title: string, rows: string[]): void {
  doc.font('Helvetica-Bold').fontSize(13).text(title);
  doc.font('Helvetica').fontSize(10);
  if (rows.length === 0) {
    doc.text('None');
  } else {
    for (const row of rows) doc.text(row, { indent: 12 });
  }
  doc.moveDown(0.6);
}

function label(fill: { mode: string | null; outcome: string | null }): string {
  if (fill.outcome) return fill.outcome.toUpperCase();
  return fill.mode ?? 'spot';
}

export async function buildStatementInput(
  pool: Pool,
  venueId: string,
  memberId: string,
  month: string,
  start: Date,
  end: Date,
  venueName: string,
  memberName: string
): Promise<StatementInput> {
  const deposits = await pool.query(
    `SELECT id, amount_cents, created_at FROM deposits WHERE member_id = $1 AND status = 'succeeded' AND created_at >= $2 AND created_at < $3 ORDER BY created_at`,
    [memberId, start, end]
  );
  const refunds = await pool.query(
    `SELECT id, amount_cents, created_at FROM refunds WHERE member_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at`,
    [memberId, start, end]
  );
  const fills = await pool.query(
    `SELECT f.symbol, f.mode, f.outcome, f.side, f.price, f.quantity, f.fee_cents, f.filled_at AS created_at, f.kind
     FROM (SELECT fills.*, markets.symbol, markets.kind FROM fills JOIN markets ON markets.id = fills.market_id WHERE fills.member_id = $1 AND fills.filled_at >= $2 AND fills.filled_at < $3) f
     ORDER BY f.filled_at`,
    [memberId, start, end]
  );
  void venueId;
  const payoutLegs = await pool.query(
    `SELECT e.reference_id, e.created_at, COALESCE(SUM(CASE WHEN l.account LIKE 'member:%' THEN l.amount_cents ELSE 0 END), 0) AS amount
     FROM journal_entries e JOIN journal_legs l ON l.entry_id = e.id
     WHERE e.kind = 'payout' AND e.created_at >= $2 AND e.created_at < $3
       AND EXISTS (SELECT 1 FROM journal_legs l2 WHERE l2.entry_id = e.id AND l2.account = $1)
     GROUP BY e.id, e.reference_id, e.created_at ORDER BY e.created_at`,
    [`member:${memberId}:available`, start, end]
  );
  const nettingLegs = await pool.query(
    `SELECT e.reference_id, e.created_at, COALESCE(SUM(CASE WHEN l.account LIKE 'member:%' THEN l.amount_cents ELSE 0 END), 0) AS amount
     FROM journal_entries e JOIN journal_legs l ON l.entry_id = e.id
     WHERE e.kind = 'netting' AND e.created_at >= $2 AND e.created_at < $3
       AND EXISTS (SELECT 1 FROM journal_legs l2 WHERE l2.entry_id = e.id AND l2.account = $1)
     GROUP BY e.id, e.reference_id, e.created_at ORDER BY e.created_at`,
    [`member:${memberId}:available`, start, end]
  );
  const liquidationLegs = await pool.query(
    `SELECT e.reference_id, e.created_at, COALESCE(SUM(CASE WHEN l.account LIKE 'member:%' THEN l.amount_cents ELSE 0 END), 0) AS amount
     FROM journal_entries e JOIN journal_legs l ON l.entry_id = e.id
     WHERE e.kind = 'liquidation' AND e.created_at >= $2 AND e.created_at < $3
       AND EXISTS (SELECT 1 FROM journal_legs l2 WHERE l2.entry_id = e.id AND l2.account = $1)
     GROUP BY e.id, e.reference_id, e.created_at ORDER BY e.created_at`,
    [`member:${memberId}:available`, start, end]
  );
  const opening = await totalBalanceAt(pool, memberId, start);
  const closing = await totalBalanceAt(pool, memberId, end);
  return {
    venueName,
    memberName,
    month,
    openingCents: opening,
    closingCents: closing,
    deposits: deposits.rows as { id: string; amount_cents: number; created_at: Date }[],
    refunds: refunds.rows as { id: string; amount_cents: number; created_at: Date }[],
    fills: (fills.rows as { symbol: string; mode: string | null; outcome: string | null; side: string; price: number; quantity: number; fee_cents: number; kind: 'pair' | 'event'; created_at: Date }[]),
    payouts: payoutLegs.rows.map((r: { reference_id: string; created_at: Date; amount: string }) => ({ market_id: r.reference_id, amount_cents: Number(r.amount), created_at: r.created_at })),
    nettings: nettingLegs.rows.map((r: { reference_id: string; created_at: Date; amount: string }) => ({ market_id: r.reference_id, amount_cents: Number(r.amount), created_at: r.created_at })),
    liquidations: liquidationLegs.rows.map((r: { reference_id: string; created_at: Date; amount: string }) => ({ market_id: r.reference_id, amount_cents: Number(r.amount), created_at: r.created_at })),
  };
}

async function totalBalanceAt(pool: Pool, memberId: string, at: Date): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(SUM(l.amount_cents), 0) AS total
     FROM journal_legs l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account LIKE $1 AND e.created_at < $2`,
    [`member:${memberId}:%`, at]
  );
  return Number((res.rows[0] as { total: string }).total);
}
