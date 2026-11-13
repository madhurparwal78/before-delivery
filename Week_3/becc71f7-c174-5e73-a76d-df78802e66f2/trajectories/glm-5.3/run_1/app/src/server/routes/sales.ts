// The till, refunds, the sales list and the sales book (DP-24 to DP-28, DP-47, DP-48).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str, instantOf } from '../http.js';
import { ApiError } from '../errors.js';
import { consignorShareCents, vatInsideCents, eurosPlain } from '../../shared/money.js';
import { brusselsDateOf, brusselsTimeParts, brusselsMidnight, addDays, cutToSecond, toZ } from '../../shared/time.js';
import { findPieceById, liveSaleOf, priceHistory } from '../rows.js';
import { currentPriceCents } from '../pricing.js';
import { ladderJson } from '../views.js';
import type { LadderRow, PieceRow } from '../rows.js';
import { formatTagCode } from '../../shared/tagcode.js';

export const saleRoutes: Route[] = [
  {
    // The request key is judged after content type and malformed JSON (ladder step 9).
    method: 'POST', pattern: '/api/sales', bodyLimit: 65536, auth: 'desk',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const requestKey = strHeader(ctx, 'request-key');

      let storedHash: string | null = null;
      if (requestKey !== null) {
        const hash = crypto.createHash('sha256').update(ctx.body ?? '').digest('hex');
        const { rows } = await ctx.services.pool.query(
          'SELECT status, response_body, body_hash FROM request_keys WHERE key = $1 AND member_id = $2 AND created_at > $3',
          [requestKey, ctx.member!.id, new Date(Date.now() - 24 * 3600 * 1000)]
        );
        const row = rows[0];
        if (row) {
          if (row.body_hash !== hash) {
            throw new ApiError(409, 'request_key_reused', 'That request key was used with a different sale.');
          }
          sendRaw(ctx.res, row.status, row.response_body);
          return;
        }
        storedHash = hash;
      }

      const fields: Record<string, string> = {};
      const pieceId = str(body.pieceId);
      const payment = str(body.payment);
      const soldAtRaw = body.soldAt === undefined || body.soldAt === null ? null : instantOf(body.soldAt);

      // Body ids before field validation (ladder step 10).
      let piece: PieceRow | null = null;
      if (pieceId) {
        piece = await findPieceById(ctx.services.pool, pieceId);
        if (!piece) throw new ApiError(404, 'not_found', 'Not found.');
      } else {
        fields.pieceId = 'Choose a piece.';
      }
      if (payment !== 'card' && payment !== 'cash') fields.payment = 'Choose a payment.';
      const now = cutToSecond(new Date());
      let soldAt = now;
      if (soldAtRaw === 'invalid') {
        fields.soldAt = 'Enter a valid instant.';
      } else if (soldAtRaw !== null) {
        soldAt = cutToSecond(soldAtRaw);
        if (soldAt.getTime() > now.getTime()) {
          fields.soldAt = 'A sale can\u2019t be in the future.';
        } else if (soldAt.getTime() < now.getTime() - 730 * 86400 * 1000) {
          fields.soldAt = 'A sale can be at most 730 days back.';
        }
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);

      // The sale's price is the price in force at its instant (DP-28).
      const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece!.ladder_id])).rows[0]!;
      const history = await priceHistory(ctx.services.pool, piece!.id);
      const price = currentPriceCents(ladderJson(ladder), piece!.intake_date, soldAt, history);
      if (price === null) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { soldAt: 'The sale must fall inside the piece\u2019s period.' });
      }
      // Within the piece's period: from 00:00 on its intake date to before its period end.
      const periodEnd = brusselsMidnight(addDays(piece!.intake_date, ladder.period_end_day));
      if (soldAt.getTime() < brusselsMidnight(piece!.intake_date).getTime() || soldAt.getTime() >= periodEnd.getTime()) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { soldAt: 'The sale must fall inside the piece\u2019s period.' });
      }

      const share = consignorShareCents(price);
      const commission = price - share;
      const vat = vatInsideCents(commission);
      const refundableUntil = brusselsEndOfDay(addDays(brusselsDateOf(soldAt), 14));

      const saleId = crypto.randomUUID();
      const result = await withSaleLock(ctx, piece!.id, async () => {
        const existing = await liveSaleOf(ctx.services.pool, piece!.id);
        if (existing) {
          const { hour, minute } = brusselsTimeParts(new Date(existing.sold_at));
          const seller = await memberName(ctx, existing.sold_by);
          throw new ApiError(409, 'already_sold',
            `Sold by ${seller} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}. Nothing was charged.`);
        }
        if (piece!.status === 'archived' || piece!.status === 'returns_shelf' || piece!.status === 'donation_box' || piece!.status === 'returned') {
          throw new ApiError(409, 'not_for_sale', 'This piece is not on the rail.');
        }
        await ctx.services.pool.query(
          `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents, commission_cents, vat_cents, payment, sold_by, refundable_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [saleId, piece!.id, soldAt, price, share, commission, vat, payment!, ctx.member!.id, refundableUntil]
        );
        await ctx.services.pool.query("UPDATE pieces SET status = 'sold' WHERE id = $1", [piece!.id]);
        await ctx.services.pool.query("UPDATE holds SET status = 'sold' WHERE piece_id = $1 AND status = 'active'", [piece!.id]);
        return saleId;
      });

      const sale = await saleById(ctx, result);
      const bodyText = JSON.stringify({ sale });
      if (requestKey !== null && storedHash) {
        await ctx.services.pool.query(
          'INSERT INTO request_keys (key, member_id, body_hash, status, response_body, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [requestKey, ctx.member!.id, storedHash, 201, bodyText, new Date()]
        );
      }
      sendJson(ctx.res, 201, { sale });
    },
  },
  {
    method: 'GET', pattern: '/api/sales/:id', bodyLimit: 0, auth: 'staff',
    handle: async (ctx) => {
      const sale = await saleByIdWithNames(ctx, ctx.params.id!);
      sendJson(ctx.res, 200, { sale });
    },
  },
  {
    method: 'POST', pattern: '/api/sales/:id/refund', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const now = cutToSecond(new Date());
      const sale = await saleById(ctx, ctx.params.id!);
      if (sale.refunded_at !== null) throw new ApiError(409, 'already_refunded', 'This sale is already refunded.');
      if (now.getTime() > sale.refundable_until.getTime()) {
        throw new ApiError(409, 'refund_window_closed', 'This sale can no longer be refunded.');
      }
      const inRun = await ctx.services.pool.query('SELECT 1 FROM payout_sales ps JOIN payouts p ON p.id = ps.payout_id WHERE ps.sale_id = $1', [sale.id]);
      if (inRun.rows.length > 0) {
        throw new ApiError(409, 'sale_in_payout_run', 'This sale is already in a payout run and can\u2019t be refunded.');
      }
      await ctx.services.pool.query('UPDATE sales SET refunded_at = $1 WHERE id = $2', [now, sale.id]);
      // The piece goes back to the state its dates give now (DP-28).
      await ctx.services.pool.query('UPDATE pieces SET status = \'on_rail\' WHERE id = $1', [sale.piece_id]);
      await refreshPieceState(ctx, sale.piece_id, now);
      const updated = await saleByIdWithNames(ctx, sale.id);
      sendJson(ctx.res, 200, { sale: updated });
    },
  },
  {
    method: 'GET', pattern: '/api/sales', bodyLimit: 0, auth: 'books',
    handle: async (ctx) => {
      const month = ctx.url.searchParams.get('month');
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { month: 'Choose a month.' });
      }
      const lines = await salesLines(ctx, month);
      const totals = lines.reduce((acc, l) => ({
        priceCents: acc.priceCents + l.priceCents,
        consignorShareCents: acc.consignorShareCents + l.consignorShareCents,
        commissionCents: acc.commissionCents + l.commissionCents,
        vatCents: acc.vatCents + l.vatCents,
      }), { priceCents: 0, consignorShareCents: 0, commissionCents: 0, vatCents: 0 });
      sendJson(ctx.res, 200, { month, lines, totals });
    },
  },
  {
    method: 'GET', pattern: '/api/sales-book', bodyLimit: 0, auth: 'books',
    handle: async (ctx) => {
      const month = ctx.url.searchParams.get('month');
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { month: 'Choose a month.' });
      }
      // The download limit is counted per member, judged as soon as the member is known.
      const window = ctx.services.config.timers.bookFileRateWindowSeconds;
      const cutoff = new Date(Date.now() - window * 1000);
      const { rows: recent } = await ctx.services.pool.query(
        'SELECT created_at FROM book_downloads WHERE member_id = $1 AND created_at > $2 ORDER BY created_at',
        [ctx.member!.id, cutoff]
      );
      if (recent.length >= 5) {
        const oldest = new Date(recent[0]!.created_at).getTime();
        const retryAfter = Math.ceil((oldest + window * 1000 - Date.now()) / 1000);
        throw new ApiError(429, 'rate_limited',
          'You\u2019ve downloaded the sales book 5 times in a short while. Try again in a moment.',
          undefined, { 'Retry-After': String(Math.max(0, retryAfter)) });
      }
      await ctx.services.pool.query('INSERT INTO book_downloads (member_id, created_at) VALUES ($1, $2)', [ctx.member!.id, new Date()]);

      const lines = await salesLines(ctx, month);
      const csv = salesBookCsv(lines);
      ctx.res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sales-book-${month}.csv"`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end(csv);
    },
  },
];

function strHeader(ctx: RouteContext, name: 'request-key'): string | null {
  const v = ctx.req.headers[name];
  if (typeof v !== 'string' || v.length === 0) return null;
  if (v.length > 100) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { requestKey: 'A request key is 1 to 100 characters.' });
  return v;
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

function sendRaw(res: import('node:http').ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

interface SaleRecord {
  id: string; piece_id: string; sold_at: Date; price_cents: number; consignor_share_cents: number;
  commission_cents: number; vat_cents: number; payment: string; sold_by: string;
  refunded_at: Date | null; refundable_until: Date;
}

async function saleById(ctx: RouteContext, id: string): Promise<SaleRecord> {
  const { rows } = await ctx.services.pool.query<SaleRecord>('SELECT * FROM sales WHERE id = $1', [id]);
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

async function saleByIdWithNames(ctx: RouteContext, id: string): Promise<unknown> {
  const sale = await saleById(ctx, id);
  const piece = await findPieceById(ctx.services.pool, sale.piece_id);
  const consignor = piece ? (await ctx.services.pool.query<{ name: string }>('SELECT name FROM consignors WHERE id = $1', [piece.consignor_id])).rows[0] : null;
  const seller = await memberName(ctx, sale.sold_by);
  const sellerId = sale.sold_by;
  return {
    id: sale.id,
    pieceId: sale.piece_id,
    tagCode: piece ? formatTagCode(piece.tag_digits) : null,
    soldAt: toZ(new Date(sale.sold_at)),
    priceCents: sale.price_cents,
    consignorShareCents: sale.consignor_share_cents,
    commissionCents: sale.commission_cents,
    vatCents: sale.vat_cents,
    payment: sale.payment,
    soldBy: { id: sellerId, name: seller },
    consignorName: consignor?.name ?? 'Erased consignor',
    refundedAt: sale.refunded_at ? toZ(new Date(sale.refunded_at)) : null,
    refundableUntil: toZ(new Date(sale.refundable_until)),
  };
}

async function memberName(ctx: RouteContext, id: string): Promise<string> {
  const { rows } = await ctx.services.pool.query<{ name: string }>('SELECT name FROM members WHERE id = $1', [id]);
  return rows[0]?.name ?? 'A member';
}

/** One sale per piece: two till presses at the same moment record exactly one sale (DP-27). */
async function withSaleLock<T>(ctx: RouteContext, pieceId: string, fn: () => Promise<T>): Promise<T> {
  const client = await ctx.services.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale:${pieceId}`]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 23:59:59 Brussels on day 14; the window closes at 00:00 on day 15 (DP-28). */
function brusselsEndOfDay(date: string): Date {
  return new Date(brusselsMidnight(addDays(date, 1)).getTime() - 1000);
}

/** Sales lines in sales book order: by soldAt then sale id (DP-47). */
async function salesLines(ctx: RouteContext, month: string): Promise<{ saleId: string; soldAt: string; tagCode: string; description: string; priceCents: number; consignorShareCents: number; commissionCents: number; vatCents: number; consignorName: string; soldAtDate: string; soldAtTime: string; month: string }[]> {
  const start = brusselsMonthStart(month);
  const end = brusselsMonthStart(nextMonth(month));
  const { rows } = await ctx.services.pool.query(`
    SELECT s.id, s.sold_at, s.price_cents, s.consignor_share_cents, s.commission_cents, s.vat_cents,
           p.tag_digits, p.description, p.id AS piece_id, c.name AS consignor_name, c.status AS consignor_status
    FROM sales s
    JOIN pieces p ON p.id = s.piece_id
    JOIN consignors c ON c.id = p.consignor_id
    WHERE s.refunded_at IS NULL AND s.sold_at >= $1 AND s.sold_at < $2
    ORDER BY s.sold_at, s.id`, [start, end]);
  return rows.map((r) => {
    const { date, hour, minute } = brusselsTimeParts(new Date(r.sold_at));
    return {
      saleId: r.id,
      soldAt: toZ(new Date(r.sold_at)),
      soldAtDate: date,
      soldAtTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      tagCode: formatTagCode(r.tag_digits),
      description: r.description,
      priceCents: r.price_cents,
      consignorShareCents: r.consignor_share_cents,
      commissionCents: r.commission_cents,
      vatCents: r.vat_cents,
      consignorName: r.consignor_status === 'erased' ? 'Erased consignor' : r.consignor_name,
      month,
    };
  });
}

function brusselsMonthStart(month: string): Date {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return brusselsMidnight(`${y}-${String(m).padStart(2, '0')}-01`);
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The sales book file (DP-47). */
function salesBookCsv(lines: { soldAtDate: string; soldAtTime: string; tagCode: string; description: string; priceCents: number; consignorShareCents: number; commissionCents: number; vatCents: number }[]): string {
  const rows = [
    ['Sale date', 'Tag code', 'Description', 'Sale price', 'Consignor share', 'Commission', 'VAT'],
    ...lines.map((l) => [
      `${l.soldAtDate} ${l.soldAtTime}`,
      l.tagCode,
      l.description,
      eurosPlain(l.priceCents),
      eurosPlain(l.consignorShareCents),
      eurosPlain(l.commissionCents),
      eurosPlain(l.vatCents),
    ]),
  ];
  const total = lines.reduce((acc, l) => ({
    priceCents: acc.priceCents + l.priceCents,
    shareCents: acc.shareCents + l.consignorShareCents,
    commissionCents: acc.commissionCents + l.commissionCents,
    vatCents: acc.vatCents + l.vatCents,
  }), { priceCents: 0, shareCents: 0, commissionCents: 0, vatCents: 0 });
  rows.push(['Total', '', '', eurosPlain(total.priceCents), eurosPlain(total.shareCents), eurosPlain(total.commissionCents), eurosPlain(total.vatCents)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Double quotes doubled, and an apostrophe before a cell that starts with =, +, -, @, tab or CR. */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** After a refund the piece takes the state its dates give now (DP-28). */
async function refreshPieceState(ctx: RouteContext, pieceId: string, now: Date): Promise<void> {
  const piece = await findPieceById(ctx.services.pool, pieceId);
  if (!piece) return;
  const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
  const endsAt = brusselsMidnight(addDays(piece.intake_date, ladder.period_end_day));
  const shelfDeadline = brusselsMidnight(addDays(piece.intake_date, ladder.period_end_day + 14));
  if (now.getTime() >= endsAt.getTime()) {
    const to = piece.choice === 'return' ? 'returns_shelf' : 'donation_box';
    await ctx.services.pool.query('UPDATE pieces SET status = $1 WHERE id = $2', [to, piece.id]);
  } else {
    await ctx.services.pool.query("UPDATE pieces SET status = 'on_rail' WHERE id = $1", [piece.id]);
  }
  if (now.getTime() >= shelfDeadline.getTime()) {
    await ctx.services.pool.query("UPDATE pieces SET status = 'donation_box' WHERE id = $1 AND status = 'returns_shelf'", [piece.id]);
  }
}

