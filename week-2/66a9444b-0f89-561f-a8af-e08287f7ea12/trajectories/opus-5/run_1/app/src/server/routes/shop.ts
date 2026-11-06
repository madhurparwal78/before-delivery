import { Router } from 'express';
import { many, one, pool, withTransaction } from '../db/pool.js';
import { conflict, notFound, payloadTooLarge } from '../lib/errors.js';
import { withIdempotency } from '../http/idempotency.js';
import { requireCaller, requireRole, type Caller } from '../http/middleware.js';
import { parseMultipart } from '../http/multipart.js';
import {
  asInteger,
  asString,
  asStringArray,
  asTrimmed,
  expectObject,
  fail,
  looksLikeEmail,
} from '../http/validate.js';
import {
  compensate,
  newCompensation,
  runCheckout,
  type CheckoutRequest,
  type PassRequest,
} from '../domain/checkout.js';
import {
  currentPass,
  loadLine,
  loadOrder,
  orderLines,
  serialiseOrder,
  type OrderRow,
} from '../domain/orders.js';
import { liveOffer } from '../domain/liveness.js';
import { loadSessionForUpdate, seatsRemaining } from '../domain/programme.js';
import {
  activeHolds,
  createHold,
  joinWaitlist,
  loadOwnHold,
  releaseHold,
  serialiseHold,
  alreadyWaiting,
  waitlistFor,
} from '../domain/seats.js';
import {
  insertProof,
  loadProofForOrder,
  newProofId,
  serialiseProof,
} from '../domain/proofs.js';
import { transferLine } from '../domain/transfers.js';
import { voucherBalance, voucherExists } from '../domain/vouchers.js';
import { decodeImage, fileNameAllowed, sniffType } from '../services/images.js';
import { getObject, objectKeys, putObject } from '../services/storage.js';
import { toUtcIso } from '../lib/time.js';
import { limits } from '../config.js';

export const shopRouter = Router();

const BUYER_ROLES = ['visitor', 'group_booker'] as const;

function holdLimit(caller: Caller): number {
  return caller.role === 'group_booker' ? 30 : 4;
}

/** An order is visible to its buyer, to group bookers of its organisation, and to finance. */
async function visibleOrder(caller: Caller, orderId: string): Promise<OrderRow> {
  const order = await loadOrder(pool, orderId);
  if (order === null) throw notFound();
  if (order.user_id === caller.id) return order;
  if (caller.role === 'finance') return order;
  if (
    caller.role === 'group_booker' &&
    order.organisation_id !== null &&
    order.organisation_id === caller.organisationId
  ) {
    return order;
  }
  throw notFound();
}

shopRouter.post('/holds', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const body = expectObject(req.body);
  const sessionId = asTrimmed(body['session_id']);
  const quantity = asInteger(body['quantity']);
  if (sessionId === null) throw notFound();

  const outcome = await withTransaction(async (tx) => {
    const session = await loadSessionForUpdate(tx, sessionId);
    if (session === null) throw notFound();
    if (session.effective_status === 'cancelled') throw conflict('session_cancelled');
    if (session.effective_status !== 'published') throw conflict('not_on_sale');
    if (session.admission !== 'seat') fail('session_id', 'no_seats');
    if (quantity === null || quantity < 1 || quantity > holdLimit(caller)) {
      fail('quantity', 'out_of_range');
    }

    const remaining = (await seatsRemaining(tx, sessionId)) ?? 0;
    if (remaining < quantity) {
      throw conflict('sold_out', { seats_remaining: remaining, waitlist: true });
    }
    const hold = await createHold(tx, caller.id, sessionId, quantity);
    return { hold: serialiseHold(hold), seats_remaining: (await seatsRemaining(tx, sessionId)) ?? 0 };
  });

  res.status(201).json({ ...outcome.hold, seats_remaining: outcome.seats_remaining });
});

shopRouter.get('/holds', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const holds = await activeHolds(pool, caller.id);
  res.status(200).json({ holds: holds.map(serialiseHold) });
});

shopRouter.delete('/holds/:id', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  await withTransaction(async (tx) => {
    const hold = await loadOwnHold(tx, req.params.id, caller.id);
    if (hold === null) throw notFound();
    if (!hold.live) throw conflict('hold_not_active');
    await releaseHold(tx, hold.id);
  });
  res.status(204).end();
});

shopRouter.post('/sessions/:id/waitlist', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const entry = await withTransaction(async (tx) => {
    const session = await loadSessionForUpdate(tx, req.params.id);
    if (session === null) throw notFound();
    if (session.effective_status !== 'published' || session.admission !== 'seat') {
      throw conflict('not_on_sale');
    }
    if (await alreadyWaiting(tx, caller.id, session.id)) throw conflict('already_waiting');
    const remaining = (await seatsRemaining(tx, session.id)) ?? 0;
    if (remaining > 0) throw conflict('seats_available');
    return joinWaitlist(tx, caller.id, session.id);
  });
  res.status(201).json({
    id: entry.id,
    session_id: entry.session_id,
    position: entry.position,
    status: 'waiting',
  });
});

shopRouter.get('/waitlist', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const entries = await waitlistFor(pool, caller.id);
  res.status(200).json({
    entries: entries.map((entry) => ({
      id: entry.id,
      session_id: entry.session_id,
      title: entry.title,
      position: entry.position,
      status: entry.status,
      offer_expires_at:
        entry.offer_expires_at === null ? null : toUtcIso(entry.offer_expires_at),
    })),
  });
});

shopRouter.post('/waitlist/:id/claim', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const hold = await withTransaction(async (tx) => {
    const entry = await one<{ id: string; session_id: string; status: string; live: boolean }>(
      tx,
      `SELECT w.id, w.session_id, w.status, (${liveOffer('w')}) AS live FROM waitlist_entries w
       WHERE w.id = $1 AND w.user_id = $2 FOR UPDATE`,
      [req.params.id, caller.id],
    );
    if (entry === null) throw notFound();
    if (entry.status !== 'offered') throw conflict('no_offer');
    if (!entry.live) throw conflict('offer_lapsed');
    await tx.query(`UPDATE waitlist_entries SET status = 'claimed' WHERE id = $1`, [entry.id]);
    return createHold(tx, caller.id, entry.session_id, 1);
  });
  res.status(201).json(serialiseHold(hold));
});

shopRouter.post('/checkout', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  await withIdempotency(req, res, caller.id, 'checkout', async () => {
    const request = readCheckoutRequest(req.body);
    const compensation = newCompensation();
    try {
      const order = await withTransaction(async (tx) =>
        runCheckout(tx, caller, request, compensation),
      );
      return { status: 201, body: await serialiseOrder(pool, order) };
    } catch (error) {
      await compensate(compensation);
      throw error;
    }
  });
});

function readCheckoutRequest(raw: unknown): CheckoutRequest {
  const body = expectObject(raw);
  const holdIds = asStringArray(body['hold_ids']) ?? [];
  const passesRaw = Array.isArray(body['passes']) ? body['passes'] : [];
  const passes: PassRequest[] = [];
  for (const item of passesRaw) {
    const pass = expectObject(item);
    const product = asString(pass['product']);
    if (product === 'full_festival') {
      passes.push({ product: 'full_festival' });
      continue;
    }
    if (product === 'day') {
      const day = asTrimmed(pass['festival_day']);
      if (day === null) fail('passes', 'unknown_festival_day');
      passes.push({ product: 'day', festival_day: day as string });
      continue;
    }
    fail('passes', 'unknown_festival_day');
  }
  const rate = asString(body['rate']) === 'reduced' ? 'reduced' : 'full';
  const voucher = asTrimmed(body['voucher_code']);
  const names = asStringArray(body['attendee_names']);
  return {
    hold_ids: holdIds,
    passes,
    rate,
    voucher_code: voucher,
    attendee_names: names,
  };
}

shopRouter.get('/orders', async (req, res) => {
  const caller = requireCaller(req);
  const rows =
    caller.role === 'finance'
      ? await many<{ id: string }>(pool, `SELECT id FROM orders ORDER BY created_at DESC`)
      : caller.role === 'group_booker' && caller.organisationId !== null
        ? await many<{ id: string }>(
            pool,
            `SELECT id FROM orders WHERE user_id = $1 OR organisation_id = $2
             ORDER BY created_at DESC`,
            [caller.id, caller.organisationId],
          )
        : await many<{ id: string }>(
            pool,
            `SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
            [caller.id],
          );
  const orders = [];
  for (const row of rows) {
    const order = await loadOrder(pool, row.id);
    if (order !== null) orders.push(await serialiseOrder(pool, order));
  }
  res.status(200).json({ orders });
});

shopRouter.get('/orders/:id', async (req, res) => {
  const caller = requireCaller(req);
  const order = await visibleOrder(caller, req.params.id);
  res.status(200).json(await serialiseOrder(pool, order));
});

shopRouter.get('/orders/:id/passes/:code', async (req, res) => {
  const caller = requireCaller(req);
  const order = await visibleOrder(caller, req.params.id);
  const pass = await one<{ object_key: string }>(
    pool,
    `SELECT p.object_key FROM passes p JOIN order_lines l ON l.id = p.line_id
     WHERE p.code = $1 AND l.order_id = $2`,
    [req.params.code, order.id],
  );
  if (pass === null) throw notFound();
  const stored = await getObject(pass.object_key);
  if (stored === null) throw notFound();
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.code}.pdf"`);
  res.send(stored.body);
});

shopRouter.post('/orders/:id/proof', async (req, res) => {
  const caller = requireRole(req, 'visitor');
  const order = await visibleOrder(caller, req.params.id);
  if (order.user_id !== caller.id) throw notFound();

  const multipart = parseMultipart(req.rawBody, req.headers['content-type'] ?? '');
  const kind = multipart.fields['kind'];
  const file = multipart.files.find((candidate) => candidate.fieldName === 'file');

  const lines = await orderLines(pool, order.id);
  if (!lines.some((line) => line.state === 'proof_pending')) throw conflict('not_proof_pending');
  if ((await loadProofForOrder(pool, order.id)) !== null) {
    throw conflict('proof_already_uploaded');
  }
  if (kind !== 'student' && kind !== 'jobseeker') fail('kind', 'unknown');
  if (file === undefined) fail('file', 'required');
  if (file.bytes.byteLength === 0) fail('file', 'empty');
  if (file.bytes.byteLength > limits.proofBytes) throw payloadTooLarge();
  if (!fileNameAllowed(file.filename)) fail('file', 'invalid_name');

  const sniffed = sniffType(file.bytes);
  if (sniffed === null || sniffed === 'image/webp') fail('file', 'unsupported_type');
  if (sniffed !== 'application/pdf') {
    const decoded = await decodeImage(file.bytes, sniffed);
    if (decoded === null) fail('file', 'unsupported_type');
  }

  const proofId = newProofId();
  const objectKey = objectKeys.proof(order.ref, proofId);
  await putObject(objectKey, file.bytes, sniffed);
  const proof = await withTransaction((tx) =>
    insertProof(tx, order, proofId, kind, sniffed, file.bytes.byteLength, objectKey),
  );
  res.status(201).json(serialiseProof(proof));
});

shopRouter.post('/orders/:id/lines/:lineId/transfer', async (req, res) => {
  const caller = requireRole(req, ...BUYER_ROLES);
  const order = await visibleOrder(caller, req.params.id);
  if (order.user_id !== caller.id) throw notFound();
  const body = expectObject(req.body);
  const recipientName = asTrimmed(body['recipient_name']);
  const recipientEmail = asTrimmed(body['recipient_email']);

  const outcome = await withTransaction(async (tx) => {
    const line = await loadLine(tx, req.params.lineId);
    if (line === null || line.order_id !== order.id) throw notFound();
    if (line.state === 'transferred') throw conflict('already_transferred');
    if (line.state !== 'captured') throw conflict('line_not_transferable');
    if (recipientName === null || recipientName.length > 200) {
      fail('recipient_name', 'required');
    }
    if (recipientEmail === null || !looksLikeEmail(recipientEmail)) {
      fail('recipient_email', 'invalid');
    }
    const transfer = await transferLine(
      tx,
      order,
      line,
      recipientName as string,
      recipientEmail as string,
    );
    const updated = await loadLine(tx, line.id);
    if (updated === null) throw new Error('line vanished during transfer');
    return { line: updated, passCode: transfer.passCode };
  });

  const pass = await currentPass(pool, outcome.line.id);
  res.status(200).json({
    line: {
      id: outcome.line.id,
      position: outcome.line.position,
      kind: outcome.line.kind,
      session_id: outcome.line.session_id,
      festival_day: outcome.line.festival_day,
      title: outcome.line.title,
      holder_name: outcome.line.holder_name,
      state: outcome.line.state,
      list_cents: outcome.line.list_cents,
      group_discount_cents: outcome.line.group_discount_cents,
      voucher_cents: outcome.line.voucher_cents,
      charged_cents: outcome.line.charged_cents,
      pass,
    },
    pass: { code: outcome.passCode, status: 'valid' },
  });
});

shopRouter.get('/vouchers/:code', async (req, res) => {
  requireCaller(req);
  const code = req.params.code;
  if (!(await voucherExists(pool, code))) throw notFound();
  res.status(200).json({ code, balance_cents: await voucherBalance(pool, code) });
});
