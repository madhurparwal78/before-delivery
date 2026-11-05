import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { bodyOf } from '../http/body.js';
import { sendJson } from '../http/respond.js';
import { requireRole } from './session.js';
import { query, one } from '../db/db.js';
import { getOrderByRef, applyRefund } from '../domain/commerce.js';
import { idempotent } from '../domain/idempotency.js';
import { idempotencyKeyOf } from './checkout.js';
import { queueCounts } from '../queue/runner.js';
import { serviceSnapshot } from '../providers/availability.js';
import { getModelById } from '../domain/models.js';
import { isEmail } from '../domain/ids.js';

export function registerStaffRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/staff/orders',
    allowedParams: ['email', 'order'],
    handler: async ctx => {
      await requireRole(ctx, ['staff']);
      const email = ctx.query.get('email');
      const order = ctx.query.get('order');
      if ((email === null || email === '') && (order === null || order === '')) {
        throw validationError({ lookup: 'Give either an email or an order reference.' });
      }
      if (email !== null && email !== '' && order !== null && order !== '') {
        throw validationError({ lookup: 'Give either an email or an order reference.' });
      }
      if (email !== null && email !== '' && !isEmail(email)) {
        throw validationError({ email: 'Enter a valid email address.' });
      }
      const rows =
        order !== null && order !== ''
          ? await query('SELECT * FROM orders WHERE order_ref = $1 ORDER BY created_at DESC', [order])
          : await query('SELECT * FROM orders WHERE lower(buyer_email) = lower($1) ORDER BY created_at DESC', [email]);
      const items = [];
      for (const row of rows.rows) {
        const model = await getModelById(row.model_id as number);
        items.push({
          order: row.order_ref,
          email: row.buyer_email,
          model: model?.slug ?? '',
          licence: row.licence,
          seats: row.seats,
          refunded_seats: row.refunded_seats,
          amount_cents: row.amount_cents,
          refunded_cents: row.refunded_cents,
          refundable_cents: row.status === 'refunded' ? 0 : row.amount_cents - row.refunded_cents,
          status: row.status,
          edition_number: row.edition_number,
          created_at: row.created_at,
          locale: row.locale,
        });
      }
      sendJson(ctx, 200, { orders: items });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/staff/orders/:ref/refunds',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      await requireRole(ctx, ['staff']);
      const key = idempotencyKeyOf(ctx);
      const orderRef = ctx.params['ref'] ?? '';
      const body = bodyOf(ctx);
      for (const name of Object.keys(body)) {
        if (!['kind', 'seats'].includes(name)) throw validationError({ [name]: 'Unknown field.' });
      }
      const kind = String(body['kind'] ?? '');
      if (kind !== 'full' && kind !== 'seats') {
        throw validationError({ kind: 'Choose one of the listed values.' });
      }
      const seats = kind === 'seats' ? Number(body['seats']) : null;
      if (kind === 'seats' && (!Number.isInteger(seats) || (seats ?? 0) < 1)) {
        throw validationError({ seats: 'Choose fewer seats than the licence still holds.' });
      }
      const order = await getOrderByRef(orderRef);
      if (order === null) throw new ApiError(404, 'not_found');
      const rawBody = JSON.stringify(bodyOf(ctx));
      const response = await idempotent('refund', key, rawBody, async () => {
        const result = await applyRefund(orderRef, kind, seats, key);
        return {
          status: 201,
          body: JSON.stringify({
            order: result.order_ref,
            refund_cents: result.refund_cents,
            refunded_cents: result.refunded_cents,
            refundable_cents: result.refundable_cents,
            status: result.status,
          }),
          contentType: 'application/json',
        };
      });
      sendJson(ctx, response.status, JSON.parse(response.body));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/staff/health',
    allowedParams: [],
    handler: async ctx => {
      await requireRole(ctx, ['staff']);
      const counts = await queueCounts();
      sendJson(ctx, 200, {
        services: serviceSnapshot(),
        checked_at: new Date().toISOString(),
        queue: counts,
      });
    },
  });
}
