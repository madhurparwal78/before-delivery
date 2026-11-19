import { query, queryOne } from '../db/pool';
import { invalid } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import { LEDGER_CSV_HEADER, ledgerCsvRow } from '../domain/csv';
import { ledgerFooter, ledgerLineView, type PostedLine } from '../domain/ledger';
import { answerPage, integerIdSql, padNumber, pageClause } from './lists';
import { onlyRoles } from './visibility';
import { bytes, reply, signedIn, type Ctx, type Reply } from './types';

/** The cloth ledger: pages newest first, whole-set totals and the byte-exact export. */

interface LedgerRow {
  readonly line_id: string;
  readonly pair_id: string;
  readonly posted_at: Date;
  readonly account: string;
  readonly amount_mm2: string;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly actor_email: string;
  readonly reason: string;
}

export async function listLedger(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const stock = ctx.query.get('stock');
  const order = { at: 'posted_at', id: integerIdSql('line_id') };
  const clause = pageClause(ctx, { stock }, order, 1);
  const values: unknown[] = [...clause.values];
  let where = '';
  if (stock !== null && stock !== '') {
    const known = await queryOne<{ code: string }>('SELECT code FROM stock WHERE code = $1', [stock]);
    if (known === null) throw invalid({ stock: FIELD_COPY.stock });
    values.push(stock);
    where = ` AND stock_code = $${values.length}`;
  }
  const page = await answerPage<LedgerRow, PostedLine>(
    clause,
    {
      sql: `SELECT * FROM ledger_line WHERE true ${clause.where} ${where}
             ORDER BY posted_at DESC, line_id DESC LIMIT ${clause.limit + 1}`,
      values,
      countSql:
        stock === null || stock === ''
          ? 'SELECT count(*)::text n FROM ledger_line'
          : 'SELECT count(*)::text n FROM ledger_line WHERE stock_code = $1',
      countValues: stock === null || stock === '' ? [] : [stock],
      position: (row) => ({
        at: row.posted_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        id: padNumber(row.line_id),
      }),
    },
    (row) => ledgerLineView(row),
  );
  const footer = await ledgerFooter({ query: (t, v) => query(t, v ?? []), one: (t, v) => queryOne(t, v ?? []) },
    stock === null || stock === '' ? null : stock);
  return reply(200, { ...page, footer });
}

export async function reconciliation(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const totals = await queryOne<{ lines: string; ledger_sum: string; stored: string; ledger_on_hand: string }>(
    `SELECT (SELECT count(*) FROM ledger_line)::text lines,
            (SELECT coalesce(sum(amount_mm2),0) FROM ledger_line)::text ledger_sum,
            (SELECT coalesce(sum(on_hand_mm2),0) FROM stock)::text stored,
            (SELECT coalesce(sum(amount_mm2),0) FROM ledger_line
               WHERE account IN (SELECT code FROM stock))::text ledger_on_hand`,
  );
  const items = await query<{ code: string; stored: string; ledger: string }>(
    `SELECT s.code,
            s.on_hand_mm2::text stored,
            coalesce((SELECT sum(amount_mm2) FROM ledger_line l WHERE l.account = s.code),0)::text ledger
       FROM stock s ORDER BY s.code ASC`,
  );
  const stored = Number(totals?.stored ?? '0');
  const ledgerOnHand = Number(totals?.ledger_on_hand ?? '0');
  return reply(200, {
    lines: Number(totals?.lines ?? '0'),
    ledger_sum_mm2: Number(totals?.ledger_sum ?? '0'),
    stored_on_hand_mm2: stored,
    ledger_on_hand_mm2: ledgerOnHand,
    difference_mm2: stored - ledgerOnHand,
    items: items.map((item) => ({
      stock_code: item.code,
      stored_on_hand_mm2: Number(item.stored),
      ledger_on_hand_mm2: Number(item.ledger),
      difference_mm2: Number(item.stored) - Number(item.ledger),
    })),
  });
}

/** Newest first by `posted_at`, then by `line_id` descending, line for line. */
export async function exportLedger(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const rows = await query<LedgerRow>(
    'SELECT * FROM ledger_line ORDER BY posted_at DESC, line_id DESC',
  );
  const lines = [LEDGER_CSV_HEADER];
  for (const row of rows) {
    const line = ledgerLineView(row);
    lines.push(ledgerCsvRow(line));
  }
  return bytes(200, Buffer.from(`${lines.join('\n')}\n`, 'utf8'), 'text/csv; charset=utf-8');
}
