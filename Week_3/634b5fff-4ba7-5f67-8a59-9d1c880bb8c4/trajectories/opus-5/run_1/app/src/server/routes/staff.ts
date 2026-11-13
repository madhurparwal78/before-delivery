import { Router } from 'express';
import busboy from 'busboy';
import { errorCopy, plateFor } from '../../shared/copy.js';
import type { BoxState, StaffHit } from '../../shared/types.js';
import { ART_MAX_BODY_BYTES, knownPlate, savePlateArt } from '../art.js';
import { announceBox, moveBox, remainingStock, storedBoxState, syncSearch } from '../boxes.js';
import { replayWaiting } from '../callbacks.js';
import { businessNow, realNow } from '../clock.js';
import { config } from '../config.js';
import { inTransaction, query } from '../db.js';
import { ApiError, fail, failOutage, failStorage } from '../errors.js';
import {
  deadLetters,
  dismissDeadLetter,
  eventsWaitingForBroker,
  publishPendingEvents,
  retryDeadLetter,
  writeFulfilmentEvent,
} from '../fulfilment.js';
import { alertsWaiting } from '../services/alerts.js';
import { handler, requireHeader, requireStaff } from '../http.js';
import { claimKey, hashRequest, releaseKey, storeResult } from '../idempotency.js';
import { ledgerFor } from '../ledger.js';
import { loadOrder } from '../orders.js';
import {
  completeCaptureIfConfirmed,
  markCaptureFailed,
  requireLedger,
  reserveRefund,
  settleRefundIfConfirmed,
  dropRefund,
} from '../payments.js';
import { rateHistory, scheduleRate } from '../rates.js';
import { assertDeadQueueReadable, QueueUnreachable } from '../services/broker.js';
import * as gateway from '../services/gateway.js';
import { LedgerUnreachable } from '../services/killbill.js';
import { SearchUnreachable, searchStaff } from '../services/search.js';
import { setCharityEndpoint, readDeliveries, WebhooksUnreachable } from '../services/webhooks.js';
import { issueStatement, listStatements, statementPdf } from '../statements.js';
import { CHARITY_ENDPOINT_SETTING } from '../seed.js';

export const staffRouter: Router = Router();

staffRouter.get(
  '/api/staff/me',
  handler(async (req, res) => {
    const identity = req.staff;
    if (identity === undefined) throw fail(401, 'sign_in_required');
    res.json({ username: identity.username, roles: identity.roles });
  }),
);

staffRouter.get(
  '/api/staff/search',
  requireStaff('maker', 'packer', 'treasurer'),
  handler(async (req, res) => {
    const text = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (text === '') {
      res.json({ hits: [], degraded: false });
      return;
    }
    try {
      const documents = await searchStaff(text);
      res.json({
        hits: documents.map((document) => ({
          number: document.number,
          plate: document.plate,
          state: document.state as BoxState,
          recipientName: document.recipientName,
          reference: document.reference,
        })),
        degraded: false,
      });
      return;
    } catch (error) {
      if (!(error instanceof SearchUnreachable)) throw error;
    }
    const number = Number.parseInt(text, 10);
    const rows = await query<{
      number: number;
      state: BoxState;
      recipient_name: string | null;
      reference: string | null;
    }>(
      `SELECT b.number, b.state,
              CASE WHEN o.reference IS NULL THEN NULL
                   WHEN o.is_gift THEN o.recipient_name ELSE o.buyer_name END AS recipient_name,
              o.reference
         FROM boxes b LEFT JOIN orders o ON o.box_number = b.number AND o.live_claim
        WHERE b.number = $1
           OR lower(b.plate) = lower($2)
           OR (o.is_gift AND o.recipient_name ILIKE '%' || $2 || '%')
           OR (NOT o.is_gift AND o.buyer_name ILIKE '%' || $2 || '%')
        ORDER BY b.number LIMIT 20`,
      [Number.isInteger(number) ? number : -1, text],
    );
    const hits: StaffHit[] = rows.map((row) => ({
      number: row.number,
      plate: plateFor(row.number),
      state: row.state,
      recipientName: row.recipient_name,
      reference: row.reference,
    }));
    res.json({ hits, degraded: true });
  }),
);

staffRouter.get(
  '/api/staff/orders',
  requireStaff('packer'),
  handler(async (req, res) => {
    const wanted = typeof req.query.boxState === 'string' ? req.query.boxState : null;
    const rows = await query<{
      reference: string;
      box_number: number;
      plate: string;
      recipient_name: string | null;
      buyer_name: string;
      is_gift: boolean;
      street: string;
      postcode: string;
      city: string;
      state: BoxState;
      payment_state: string;
      tracking_code: string | null;
    }>(
      `SELECT o.reference, o.box_number, o.plate, o.recipient_name, o.buyer_name, o.is_gift,
              o.street, o.postcode, o.city, b.state, o.payment_state, o.tracking_code
         FROM orders o JOIN boxes b ON b.number = o.box_number
        WHERE o.live_claim AND ($1::text IS NULL OR b.state = $1)
        ORDER BY o.created_at DESC`,
      [wanted],
    );
    res.json({
      orders: rows.map((row) => ({
        reference: row.reference,
        number: row.box_number,
        plate: row.plate,
        recipientName: row.is_gift ? row.recipient_name : row.buyer_name,
        address: { street: row.street, postcode: row.postcode, city: row.city },
        boxState: row.state,
        paymentState: row.payment_state,
        trackingCode: row.tracking_code,
      })),
    });
  }),
);

staffRouter.post(
  '/api/staff/orders/:reference/pack',
  requireStaff('packer'),
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null) throw fail(404, 'not_found');
    const boxState = await storedBoxState(order.box_number);
    if (boxState !== 'claimed') throw fail(409, 'illegal_transition');
    if (
      order.method === 'card' &&
      order.auth_expires_at !== null &&
      realNow().getTime() >= order.auth_expires_at.getTime()
    ) {
      throw fail(409, 'authorisation_expired');
    }
    try {
      await requireLedger('pack');

      if (order.method === 'bank') {
        await inTransaction(async (client) => {
          await moveBox(client, order.box_number, 'claimed', 'packed');
          await writeFulfilmentEvent(
            client,
            'box.packed',
            order.reference,
            order.box_number,
            businessNow(),
          );
        });
        announceBox(order.box_number, 'packed');
        await syncSearch([order.box_number]);
        await publishPendingEvents();
        res.status(202).json({
          reference: order.reference,
          boxState: 'packed',
          paymentState: order.payment_state,
          packing: 'done',
        });
        return;
      }

      if (order.capture_requested && !order.gateway_captured) {
        res.status(202).json({
          reference: order.reference,
          boxState: 'claimed',
          paymentState: 'authorised',
          packing: 'pending',
        });
        return;
      }

      if (order.payment_id === null) throw fail(409, 'illegal_transition');
      const result = await gateway.capture(
        order.payment_id,
        order.total_ore,
        `${order.reference}-capture`,
      );

      if (result.kind === 'capture_failed') {
        await markCaptureFailed(order);
        throw new ApiError(
          402,
          'capture_refused',
          errorCopy.capture_refused(order.box_number),
          undefined,
          { reference: order.reference, boxState: 'claimed', paymentState: 'capture_failed' },
        );
      }

      if (result.kind === 'pending') {
        await query(
          'UPDATE orders SET capture_requested = true, updated_at = now() WHERE reference = $1',
          [order.reference],
        );
        res.status(202).json({
          reference: order.reference,
          boxState: 'claimed',
          paymentState: 'authorised',
          packing: 'pending',
        });
        return;
      }

      await query('UPDATE orders SET gateway_captured = true, capture_requested = true WHERE reference = $1', [
        order.reference,
      ]);
      order.gateway_captured = true;
      const done = await completeCaptureIfConfirmed(order);
      if (done) await replayWaiting(order.reference);
      res.status(202).json({
        reference: order.reference,
        boxState: done ? 'packed' : 'claimed',
        paymentState: done ? 'captured' : 'authorised',
        packing: done ? 'done' : 'pending',
      });
    } catch (error) {
      if (error instanceof gateway.GatewayUnreachable) throw failOutage('gateway_unreachable', 'pack');
      if (error instanceof LedgerUnreachable) throw failOutage('ledger_unreachable', 'pack');
      throw error;
    }
  }),
);

staffRouter.post(
  '/api/staff/boxes/:number/back-on-shelf',
  requireStaff('packer'),
  handler(async (req, res) => {
    const number = Number.parseInt(String(req.params.number), 10);
    const state = await storedBoxState(number);
    if (state !== 'returned') throw fail(409, 'illegal_transition');
    await inTransaction(async (client) => {
      await moveBox(client, number, 'returned', 'available');
      await client.query('UPDATE orders SET live_claim = false WHERE box_number = $1 AND live_claim', [
        number,
      ]);
    });
    announceBox(number, 'available');
    await syncSearch([number]);
    res.json({ number, state: 'available' });
  }),
);

staffRouter.get(
  '/api/staff/dead-letters',
  requireStaff('packer'),
  handler(async (unusedRequest, res) => {
    try {
      await assertDeadQueueReadable();
    } catch {
      throw fail(503, 'queue_unreachable');
    }
    res.setHeader('X-Press-Events-Waiting', (await eventsWaitingForBroker()) ? 'yes' : 'no');
    res.setHeader('X-Press-Alerts-Waiting', (await alertsWaiting()) ? 'yes' : 'no');
    res.json({ events: await deadLetters() });
  }),
);

staffRouter.post(
  '/api/staff/dead-letters/:eventId/retry',
  requireStaff('packer'),
  handler(async (req, res) => {
    const eventId = String(req.params.eventId);
    try {
      const found = await retryDeadLetter(eventId);
      if (!found) throw fail(404, 'not_found');
    } catch (error) {
      if (error instanceof QueueUnreachable) throw fail(503, 'queue_unreachable');
      throw error;
    }
    res.status(202).json({ eventId, status: 'requeued' });
  }),
);

staffRouter.post(
  '/api/staff/dead-letters/:eventId/dismiss',
  requireStaff('packer'),
  handler(async (req, res) => {
    const eventId = String(req.params.eventId);
    const note = (req.jsonBody ?? {}).note;
    if (typeof note !== 'string' || note.trim() === '' || note.length > 280) {
      throw fail(422, 'dismissal_note_required');
    }
    try {
      const found = await dismissDeadLetter(eventId, note.trim());
      if (!found) throw fail(404, 'not_found');
    } catch (error) {
      if (error instanceof QueueUnreachable) throw fail(503, 'queue_unreachable');
      throw error;
    }
    res.json({ eventId, status: 'dismissed' });
  }),
);

staffRouter.get(
  '/api/staff/ledger/orders',
  requireStaff('treasurer'),
  handler(async (unusedRequest, res) => {
    const rows = await query<{
      reference: string;
      box_number: number;
      payment_state: string;
      state: BoxState;
      gross_ore: number;
      rate_basis_points: number;
    }>(
      `SELECT o.reference, o.box_number, o.payment_state, b.state, o.gross_ore, o.rate_basis_points
         FROM orders o JOIN boxes b ON b.number = o.box_number
        ORDER BY o.created_at DESC`,
    );
    res.json({
      orders: rows.map((row) => ({
        reference: row.reference,
        number: row.box_number,
        paymentState: row.payment_state,
        boxState: row.state,
        grossOre: row.gross_ore,
        rateBasisPoints: row.rate_basis_points,
      })),
    });
  }),
);

staffRouter.get(
  '/api/staff/orders/:reference/ledger',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null) throw fail(404, 'not_found');
    res.json(await ledgerFor(order));
  }),
);

staffRouter.post(
  '/api/staff/orders/:reference/refunds',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null) throw fail(404, 'not_found');
    const key = requireHeader(req, 'Idempotency-Key');
    if (key === '') throw fail(422, 'validation_failed');
    const raw = req.jsonBody ?? {};
    const claim = await claimKey('refund', key, hashRequest({ reference: order.reference, ...raw }));
    if (claim.kind === 'replay') {
      res.status(claim.status).json(claim.body);
      return;
    }
    let reservedId: string | null = null;
    try {
      const paid = ['captured', 'settled', 'partially_refunded'].includes(order.payment_state);
      if (!paid) throw fail(409, 'not_captured');
      const amountOre = raw.amountOre;
      if (typeof amountOre !== 'number' || !Number.isInteger(amountOre) || amountOre <= 0) {
        throw fail(422, 'refund_invalid');
      }
      await requireLedger('refund');
      const reserved = await reserveRefund(order, amountOre);
      reservedId = reserved.refund_id;

      if (order.method === 'bank' && order.transfer_id !== null) {
        await gateway.refundTransfer(order.transfer_id, amountOre, reserved.refund_id);
        await query('UPDATE refunds SET gateway_confirmed = true WHERE refund_id = $1', [
          reserved.refund_id,
        ]);
      } else if (order.payment_id !== null) {
        const started = await gateway.refundPayment(order.payment_id, amountOre, reserved.refund_id);
        await query(
          `UPDATE refunds SET gateway_refund_id = $2, gateway_confirmed = $3 WHERE refund_id = $1`,
          [reserved.refund_id, started.refundId, started.confirmation === 'immediate'],
        );
      }
      const settled = await settleRefundIfConfirmed(reserved.refund_id);
      const body = {
        refundId: reserved.refund_id,
        reference: order.reference,
        state: settled?.state ?? 'pending',
        amountOre,
        netOre: reserved.net_ore,
        vatOre: reserved.vat_ore,
        charityOre: reserved.charity_ore,
        makerOre: reserved.maker_ore,
      };
      await storeResult('refund', key, 202, body);
      res.status(202).json(body);
    } catch (error) {
      if (reservedId !== null) await dropRefund(reservedId);
      await releaseKey('refund', key);
      if (error instanceof gateway.GatewayUnreachable) throw failOutage('gateway_unreachable', 'refund');
      if (error instanceof LedgerUnreachable) throw failOutage('ledger_unreachable', 'refund');
      throw error;
    }
  }),
);

staffRouter.get(
  '/api/staff/charity-rates',
  requireStaff('treasurer'),
  handler(async (unusedRequest, res) => {
    res.json({ rates: await rateHistory() });
  }),
);

staffRouter.post(
  '/api/staff/charity-rates',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    const body = req.jsonBody ?? {};
    res.status(201).json(await scheduleRate(body.rateBasisPoints, body.effectiveFrom));
  }),
);

staffRouter.get(
  '/api/staff/statements',
  requireStaff('treasurer'),
  handler(async (unusedRequest, res) => {
    res.json({ statements: await listStatements() });
  }),
);

staffRouter.post(
  '/api/staff/statements',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    res.status(201).json(await issueStatement((req.jsonBody ?? {}).month));
  }),
);

staffRouter.get(
  '/api/staff/statements/:id/pdf',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    let pdf;
    try {
      pdf = await statementPdf(String(req.params.id), null);
    } catch {
      throw failStorage('download');
    }
    if (pdf === null) throw fail(404, 'not_found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(pdf);
  }),
);

staffRouter.put(
  '/api/staff/charity-endpoint',
  requireStaff('treasurer'),
  handler(async (req, res) => {
    const url = (req.jsonBody ?? {}).url;
    if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/.test(url)) throw fail(422, 'endpoint_invalid');
    try {
      await setCharityEndpoint(url);
    } catch (error) {
      if (!(error instanceof WebhooksUnreachable)) throw error;
    }
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [CHARITY_ENDPOINT_SETTING, url],
    );
    res.json({ url });
  }),
);

staffRouter.get(
  '/api/staff/deliveries',
  requireStaff('treasurer'),
  handler(async (unusedRequest, res) => {
    try {
      res.json({ deliveries: await readDeliveries() });
    } catch {
      throw fail(503, 'deliveries_unreachable');
    }
  }),
);

staffRouter.get(
  '/api/staff/stock',
  requireStaff('maker'),
  handler(async (unusedRequest, res) => {
    res.json({ remaining: await remainingStock(), thresholds: config.lowStockThresholds });
  }),
);

staffRouter.post(
  '/api/staff/plates/:plate/art',
  requireStaff('maker'),
  handler(async (req, res) => {
    const plate = knownPlate(String(req.params.plate));
    if (plate === null) throw fail(404, 'not_found');
    const file = await readUpload(req);
    res.status(201).json(await savePlateArt(plate, file));
  }),
);

async function readUpload(req: Parameters<Parameters<typeof handler>[0]>[0]): Promise<Buffer> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
  if (type !== 'multipart/form-data') throw fail(415, 'unsupported_media_type');
  return new Promise<Buffer>((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      limits: { fileSize: ART_MAX_BODY_BYTES, files: 1, fields: 4 },
    });
    const chunks: Buffer[] = [];
    let tooLarge = false;
    parser.on('file', (unusedName, stream) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        tooLarge = true;
      });
    });
    parser.on('close', () => {
      if (tooLarge) {
        reject(fail(413, 'art_too_large'));
        return;
      }
      if (chunks.length === 0) {
        reject(fail(415, 'art_wrong_type'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    parser.on('error', () => reject(fail(415, 'unsupported_media_type')));
    req.pipe(parser);
  });
}
