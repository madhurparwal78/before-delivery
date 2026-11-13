import { createHash, randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import { conflict, notFound, rateLimited, validationFailed } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { FieldProblems, readTrimmed } from '../http/validate.js';
import { inTransaction, instantOf, instantParam, isUniqueViolation, maybeInstant } from '../db.js';
import { loadPieceById, priceContextOf, statusOf } from '../data/pieces.js';
import { periodEndInstant, priceInForceAt } from '../domain/ladder.js';
import { isRefundable, refundableUntil, splitSale } from '../domain/sale.js';
import { renderSalesBook, salesBookFileName, totalsOf } from '../domain/salesBook.js';
import {
  addDays,
  brusselsDate,
  endOfBrusselsMonth,
  formatTime,
  instantFromIso,
  isValidBrusselsMonth,
  isoSeconds,
  startOfBrusselsDay,
} from '../../shared/brussels.js';
import { copy } from '../../shared/copy.js';
import { SALES_BOOK_DOWNLOAD_LIMIT } from '../../shared/shop.js';
import { isPayment } from '../../shared/options.js';

const MAX_EARLIER_SALE_DAYS = 730;
const REQUEST_KEY_HOURS = 24;

interface SaleRecord {
  id: string;
  pieceId: string;
  tagCode: string;
  description: string;
  soldAt: number;
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
  payment: string;
  soldById: string;
  soldByName: string;
  consignorName: string;
  refundedAt: number | null;
}

const SALE_SELECT = `
  SELECT s.id, s.piece_id, s.sold_at, s.price_cents, s.consignor_share_cents,
         s.commission_cents, s.vat_cents, s.payment, s.sold_by, s.refunded_at,
         p.tag_code, p.description, m.name AS sold_by_name, c.name AS consignor_name
    FROM sales s
    JOIN pieces p ON p.id = s.piece_id
    JOIN consignors c ON c.id = p.consignor_id
    JOIN members m ON m.id = s.sold_by`;

function saleOf(row: Record<string, unknown>): SaleRecord {
  return {
    id: row['id'] as string,
    pieceId: row['piece_id'] as string,
    tagCode: row['tag_code'] as string,
    description: row['description'] as string,
    soldAt: instantOf(row['sold_at']),
    priceCents: Number(row['price_cents']),
    consignorShareCents: Number(row['consignor_share_cents']),
    commissionCents: Number(row['commission_cents']),
    vatCents: Number(row['vat_cents']),
    payment: row['payment'] as string,
    soldById: row['sold_by'] as string,
    soldByName: row['sold_by_name'] as string,
    consignorName: row['consignor_name'] as string,
    refundedAt: maybeInstant(row['refunded_at']),
  };
}

function saleJson(sale: SaleRecord): unknown {
  return {
    id: sale.id,
    pieceId: sale.pieceId,
    tagCode: sale.tagCode,
    soldAt: isoSeconds(sale.soldAt),
    priceCents: sale.priceCents,
    consignorShareCents: sale.consignorShareCents,
    commissionCents: sale.commissionCents,
    vatCents: sale.vatCents,
    payment: sale.payment,
    soldBy: { id: sale.soldById, name: sale.soldByName },
    consignorName: sale.consignorName,
    refundedAt: sale.refundedAt === null ? null : isoSeconds(sale.refundedAt),
    refundableUntil: isoSeconds(refundableUntil(sale.soldAt)),
  };
}

async function saleById(ctx: RequestContext, id: string): Promise<SaleRecord> {
  const { rows } = await ctx.app.db.query(`${SALE_SELECT} WHERE s.id::text = $1`, [id]);
  const row = rows[0];
  if (row === undefined) throw notFound();
  return saleOf(row);
}

async function liveSaleOfPiece(ctx: RequestContext, pieceId: string): Promise<SaleRecord | null> {
  const { rows } = await ctx.app.db.query(
    `${SALE_SELECT} WHERE s.piece_id = $1 AND s.refunded_at IS NULL`,
    [pieceId],
  );
  const row = rows[0];
  return row === undefined ? null : saleOf(row);
}

function alreadySold(sale: SaleRecord): never {
  throw conflict('already_sold', copy.alreadySold(sale.soldByName, formatTime(sale.soldAt)));
}

/** A Brussels month's unrefunded sales, ordered by `soldAt` and then by sale id. */
export async function salesOfMonth(ctx: RequestContext, month: string): Promise<SaleRecord[]> {
  const { rows } = await ctx.app.db.query(
    `${SALE_SELECT} WHERE s.refunded_at IS NULL AND s.sold_at >= $1 AND s.sold_at < $2
      ORDER BY s.sold_at, s.id`,
    [instantParam(startOfBrusselsDay(`${month}-01`)), instantParam(endOfBrusselsMonth(month))],
  );
  return rows.map(saleOf);
}

function requireMonth(value: string | null): string {
  if (value === null || !isValidBrusselsMonth(value)) {
    throw validationFailed({ month: 'Choose a month as YYYY-MM.' });
  }
  return value;
}

export const saleRoutes: CompiledRoute[] = [
  route({
    method: 'POST',
    path: '/api/sales',
    access: 'desk',
    handle: async (ctx) => {
      const member = ctx.signedInMember();
      const requestKey = ctx.header('request-key');
      const bodyHash = createHash('sha256').update(ctx.body).digest('hex');

      // Step 9: a request key seen before answers the stored response, or 409.
      if (requestKey !== null) {
        if (requestKey.length < 1 || requestKey.length > 100) {
          throw validationFailed({ requestKey: 'Use a request key of 1 to 100 characters.' });
        }
        const { rows } = await ctx.app.db.query(
          `SELECT body_hash, status_code, response_body FROM request_keys
            WHERE member_id = $1 AND request_key = $2 AND created_at > $3`,
          [member.id, requestKey, instantParam(ctx.now - REQUEST_KEY_HOURS * 3_600_000)],
        );
        const stored = rows[0];
        if (stored !== undefined) {
          if (stored['body_hash'] !== bodyHash) {
            throw conflict('request_key_reused', 'That request key was already used.');
          }
          return jsonResponse(
            Number(stored['status_code']),
            JSON.parse(stored['response_body'] as string),
          );
        }
      }

      const body = ctx.json();
      const piece = await loadPieceById(ctx.app.db, readTrimmed(body, 'pieceId'), ctx.now);
      if (piece === null) throw notFound();

      const problems = new FieldProblems();
      const payment = readTrimmed(body, 'payment');
      if (!isPayment(payment)) problems.add('payment', 'Choose Card or Cash.');

      let soldAt = Math.floor(ctx.now / 1_000) * 1_000;
      if ('soldAt' in body && body['soldAt'] !== null) {
        const asked = typeof body['soldAt'] === 'string' ? instantFromIso(body['soldAt']) : null;
        const earliest = Math.max(
          startOfBrusselsDay(piece.intakeDate),
          startOfBrusselsDay(addDays(brusselsDate(ctx.now), -MAX_EARLIER_SALE_DAYS)),
        );
        const periodEnd = periodEndInstant(piece.ladder, piece.intakeDate);
        if (asked === null || asked > ctx.now || asked < earliest || asked >= periodEnd) {
          problems.add('soldAt', `Choose a time inside this piece's period, never ahead of now.`);
        } else {
          soldAt = Math.floor(asked / 1_000) * 1_000;
        }
      }
      problems.throwIfAny();

      const existing = await liveSaleOfPiece(ctx, piece.id);
      if (existing !== null) alreadySold(existing);
      const status = statusOf(piece, ctx.now);
      if (status !== 'on_rail' && status !== 'on_hold') {
        throw conflict('not_for_sale', `This piece isn't for sale.`);
      }

      const split = splitSale(priceInForceAt(priceContextOf(piece), soldAt));
      const id = randomUUID();

      const sale = await inTransaction(ctx.app.db, async (tx) => {
        try {
          await tx.query(
            `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents,
                                commission_cents, vat_cents, payment, sold_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              id,
              piece.id,
              instantParam(soldAt),
              split.priceCents,
              split.consignorShareCents,
              split.commissionCents,
              split.vatCents,
              payment,
              member.id,
              instantParam(ctx.now),
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            const winner = await liveSaleOfPiece(ctx, piece.id);
            if (winner !== null) alreadySold(winner);
          }
          throw error;
        }
        await tx.query(
          `UPDATE holds SET released_at = $2
            WHERE piece_id = $1 AND released_at IS NULL AND ends_at > $2`,
          [piece.id, instantParam(ctx.now)],
        );
        const { rows } = await tx.query(`${SALE_SELECT} WHERE s.id = $1`, [id]);
        return saleOf(rows[0] as Record<string, unknown>);
      });

      const payload = { sale: saleJson(sale) };
      if (requestKey !== null) {
        await ctx.app.db.query(
          `INSERT INTO request_keys (member_id, request_key, body_hash, status_code,
                                     response_body, created_at)
           VALUES ($1, $2, $3, 201, $4, $5)
           ON CONFLICT (member_id, request_key) DO NOTHING`,
          [member.id, requestKey, bodyHash, JSON.stringify(payload), instantParam(ctx.now)],
        );
      }
      return jsonResponse(201, payload);
    },
  }),

  route({
    method: 'GET',
    path: '/api/sales',
    access: 'books',
    handle: async (ctx) => {
      const month = requireMonth(ctx.query('month'));
      const sales = await salesOfMonth(ctx, month);
      return jsonResponse(200, {
        month,
        lines: sales.map((sale) => ({
          saleId: sale.id,
          soldAt: isoSeconds(sale.soldAt),
          tagCode: sale.tagCode,
          description: sale.description,
          priceCents: sale.priceCents,
          consignorShareCents: sale.consignorShareCents,
          commissionCents: sale.commissionCents,
          vatCents: sale.vatCents,
          consignorName: sale.consignorName,
        })),
        totals: totalsOf(sales),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/sales-book',
    access: 'books',
    lateLimit: async (ctx) => {
      const windowMs = ctx.app.config.bookFileRateWindowSeconds * 1_000;
      const { rows } = await ctx.app.db.query(
        `SELECT created_at FROM book_downloads
          WHERE member_id = $1 AND created_at > $2 ORDER BY created_at`,
        [ctx.signedInMember().id, instantParam(ctx.now - windowMs)],
      );
      if (rows.length >= SALES_BOOK_DOWNLOAD_LIMIT) {
        const oldest = instantOf(rows[0]?.['created_at']);
        throw rateLimited(copy.salesBookLimit, (oldest + windowMs - ctx.now) / 1_000);
      }
    },
    handle: async (ctx) => {
      const month = requireMonth(ctx.query('month'));
      const sales = await salesOfMonth(ctx, month);
      await ctx.app.db.query(
        `INSERT INTO book_downloads (id, member_id, created_at) VALUES ($1, $2, $3)`,
        [randomUUID(), ctx.signedInMember().id, instantParam(ctx.now)],
      );
      return {
        kind: 'bytes',
        status: 200,
        body: Buffer.from(renderSalesBook(sales), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': `attachment; filename="${salesBookFileName(month)}"`,
          'Cache-Control': 'no-store',
        },
      };
    },
  }),

  route({
    method: 'GET',
    path: '/api/sales/:saleId',
    access: 'staff',
    resolve: async (ctx) => saleById(ctx, ctx.param('saleId')),
    handle: async (_ctx, sale) => jsonResponse(200, { sale: saleJson(sale) }),
  }),

  route({
    method: 'POST',
    path: '/api/sales/:saleId/refund',
    access: 'desk',
    expects: 'none',
    resolve: async (ctx) => saleById(ctx, ctx.param('saleId')),
    handle: async (ctx, sale) => {
      if (sale.refundedAt !== null) {
        throw conflict('already_refunded', 'This sale was already refunded.');
      }
      const { rows } = await ctx.app.db.query(
        `SELECT payout_id FROM payout_sales WHERE sale_id = $1`,
        [sale.id],
      );
      if (rows.length > 0) throw conflict('sale_in_payout_run', copy.saleInPayoutRun);
      if (!isRefundable(sale.soldAt, ctx.now)) {
        throw conflict('refund_window_closed', copy.refundWindowClosed);
      }
      await ctx.app.db.query(`UPDATE sales SET refunded_at = $2 WHERE id = $1`, [
        sale.id,
        instantParam(ctx.now),
      ]);
      return jsonResponse(200, { sale: saleJson(await saleById(ctx, sale.id)) });
    },
  }),
];
