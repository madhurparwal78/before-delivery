import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, illegalState, notFound, serviceDown } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, funderFor, milestoneFor, ownedCommissionFor } from '../domain/access.js';
import {
  currentQuote,
  findCommission,
  holdIsActive,
  installDayOf,
  latestHold,
  listFunders,
  listMilestones,
  milestoneByKey,
  quoteIsUsable,
  requiredPiecesOf,
  shapeHold,
  venueOf,
  type CommissionRow,
  type MilestoneRow,
} from '../domain/commissions.js';
import {
  bookHold,
  placeHold,
  releaseHold,
  validateHoldDate,
} from '../domain/holds.js';
import {
  invoiceMilestone,
  payerAccount,
  producerEmail,
  recordMilestonePayment,
  recordSharePayment,
} from '../domain/billing.js';
import {
  chargeInvoice,
  claimAttempt,
  fingerprintOf,
  storeAttemptResult,
  validatePaymentBody,
} from '../domain/payments.js';
import { contractHtml, createDocument, documentKeys } from '../domain/documents.js';
import { loadInAlertInstant, queueCrewAlert, queueCrmEvent } from '../domain/notifications.js';
import { advanceState } from '../domain/transitions.js';
import { publishNow } from '../jobs/events.js';
import { layoutIsComplete } from '../../shared/placement.js';
import { QUOTE_EXPIRED } from '../../shared/copy.js';
import type { PieceKind } from '../../shared/seed.js';
import { isoUtc, isoWithVenueOffset } from '../../shared/venue-time.js';

export const checkoutRouter = Router();

checkoutRouter.post(
  '/api/commissions/:commissionId/hold',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    // A layout may hold a subset of the required pieces, so an incomplete
    // placement is reported before the state is judged.
    const canHoldLayout =
      commission.state === 'previewed' ||
      commission.state === 'placed' ||
      commission.state === 'held';
    if (!canHoldLayout) throw illegalState();
    const required = requiredPiecesOf(commission) as PieceKind[];
    if (!layoutIsComplete(commission.layout_items, required)) {
      throw new ApiError(409, 'placement_incomplete');
    }
    if (commission.state === 'previewed') throw illegalState();

    const venue = venueOf(commission);
    const date = validateHoldDate(venue, bodyObject(req)['date']);
    const hold = await placeHold(commission, venue, date);

    await withTransaction((tx) =>
      queueCrmEvent(tx, {
        commissionId: commission.id,
        clientId: commission.client_id,
        type: 'slot.held',
        data: { venueId: venue.id, date, expiresAt: isoUtc(hold.expires_at) },
      }),
    );
    await publishNow({
      type: 'hold.updated',
      commissionId: commission.id,
      status: 'held',
      audience: [commission.client_id, 'producer'],
    });

    res.status(201).json(shapeHold(hold, venue));
  }),
);

checkoutRouter.get(
  '/api/commissions/:commissionId/hold',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const hold = await latestHold(commission.id);
    if (!hold) throw notFound();
    res.json(shapeHold(hold, venueOf(commission)));
  }),
);

checkoutRouter.delete(
  '/api/commissions/:commissionId/hold',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    await releaseHold(commission.id);
    await publishNow({
      type: 'hold.updated',
      commissionId: commission.id,
      status: 'released',
      audience: [commission.client_id, 'producer'],
    });
    res.status(204).end();
  }),
);

checkoutRouter.post(
  '/api/commissions/:commissionId/sign',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);

    const hold = await latestHold(commission.id);
    if (!hold || !holdIsActive(hold)) throw new ApiError(409, 'hold_expired');
    const quote = await currentQuote(commission.id);
    if (!quote) throw illegalState();
    if (!quoteIsUsable(quote)) throw new ApiError(409, 'quote_expired', QUOTE_EXPIRED);

    const body = bodyObject(req);
    const errors: Record<string, string> = {};
    const signatureName =
      typeof body['signatureName'] === 'string' ? body['signatureName'].trim() : '';
    if (signatureName.length < 2 || signatureName.length > 80) {
      errors['signatureName'] = 'Type your full name, 2 to 80 characters.';
    }
    if (body['acceptTerms'] !== true) errors['acceptTerms'] = 'Tick the box to agree.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    const milestones = await listMilestones(commission.id);
    const deposit = milestoneByKey(milestones, 'deposit');
    if (!deposit) throw illegalState();

    const signedAt = new Date();
    const contractVersion = commission.contract_version + 1;
    const funders = await listFunders(commission.id);

    const signed = { ...commission, signature_name: signatureName, signed_at: signedAt };
    const documentId = await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE commissions
            SET signature_name = $2, signed_at = $3, contract_version = $4, updated_at = now()
          WHERE id = $1`,
        [commission.id, signatureName, signedAt, contractVersion],
      );
      return createDocument(tx, {
        commissionId: commission.id,
        kind: 'contract',
        version: contractVersion,
        label: `Commission agreement v${contractVersion}`,
        objectKey: documentKeys.contract(commission.id, contractVersion),
        html: contractHtml({
          commission: signed,
          clientName: caller.user.name,
          quote,
          funders,
          milestones,
          heldDate: hold.hold_date,
        }),
      });
    });

    // Re-signing after a hold ends keeps the unpaid deposit invoice.
    const invoiced = await invoiceMilestone(signed, deposit, signedAt);

    res.status(201).json({
      contractDocumentId: documentId,
      contractVersion,
      depositMilestoneId: invoiced.id,
    });
  }),
);

interface PaymentGuards {
  commission: CommissionRow;
}

/** Guards shared by milestone and share payments, in the published order. */
async function assertPayable(
  commission: CommissionRow,
  milestone: MilestoneRow | null,
): Promise<PaymentGuards> {
  if (commission.state === 'cancelled') throw new ApiError(409, 'commission_cancelled');
  if (milestone?.milestone_key === 'deposit') {
    const hold = await latestHold(commission.id);
    const booked = await installDayOf(commission.id);
    if (!booked && (!hold || !holdIsActive(hold))) throw new ApiError(409, 'hold_expired');
    const quote = await currentQuote(commission.id);
    if (quote && !quoteIsUsable(quote)) throw new ApiError(409, 'quote_expired', QUOTE_EXPIRED);
  }
  return { commission };
}

checkoutRouter.post(
  '/api/milestones/:milestoneId/payments',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const { milestone, commission } = await milestoneFor(pathParam(req, 'milestoneId'), caller);
    if (commission.client_id !== caller.user.id) throw new ApiError(403, 'forbidden');

    const key = req.header('idempotency-key');
    const body = bodyObject(req);
    const path = `/api/milestones/${milestone.id}/payments`;

    if (key !== undefined) {
      const claimed = await claimAttempt({
        userId: caller.user.id,
        key,
        path,
        fingerprint: fingerprintOf(body),
        targetKind: 'milestone',
        targetId: milestone.id,
      });
      if (claimed.replay) {
        res.status(claimed.replay.status).json(claimed.replay.body);
        return;
      }
      await finishMilestonePayment({
        commission,
        milestone,
        attemptId: claimed.attemptId,
        key,
        body,
        res,
      });
      return;
    }

    if (milestone.state === 'paid') throw new ApiError(409, 'already_paid');
    await assertPayable(commission, milestone);
    validatePaymentBody(key, body);
  }),
);

interface FinishOptions {
  commission: CommissionRow;
  milestone: MilestoneRow;
  attemptId: string;
  key: string;
  body: Record<string, unknown>;
  res: Parameters<Parameters<typeof route>[0]>[1];
}

async function finishMilestonePayment(options: FinishOptions): Promise<void> {
  const { commission, milestone, attemptId, key, body, res } = options;
  try {
    if (milestone.state === 'paid') throw new ApiError(409, 'already_paid');
    await assertPayable(commission, milestone);
    const card = validatePaymentBody(key, body);
    if (!milestone.killbill_invoice_id || !milestone.killbill_invoice_number) {
      throw illegalState();
    }

    await query(`UPDATE milestones SET state = 'payment_pending' WHERE id = $1`, [milestone.id]);
    const payer = await payerAccount(commission.client_id);
    const charged = await chargeInvoice(
      payer,
      {
        killbillInvoiceId: milestone.killbill_invoice_id,
        invoiceNumber: milestone.killbill_invoice_number,
        subtotalCents: milestone.subtotal_cents,
        taxCents: milestone.tax_cents,
        amountCents: milestone.amount_cents,
      },
      key,
    );

    const venue = venueOf(commission);
    await recordMilestonePayment({
      commission,
      milestone,
      payer,
      producerEmail: await producerEmail(),
      payment: charged.payment,
      venue,
    });

    if (milestone.milestone_key === 'deposit') await bookDepositDay(commission, charged.payment);

    await storeAttemptResult(attemptId, 'paid', 201, { ...charged.response }, {
      lastFour: card.lastFour,
      killbillPaymentId: charged.payment.killbillPaymentId,
    });
    res.status(201).json(charged.response);
  } catch (error) {
    await markAttemptFailed(attemptId, milestone.id, error);
    throw error;
  }
}

async function markAttemptFailed(
  attemptId: string,
  milestoneId: string | null,
  error: unknown,
): Promise<void> {
  if (milestoneId) {
    await query(
      `UPDATE milestones SET state = 'failed' WHERE id = $1 AND state = 'payment_pending'`,
      [milestoneId],
    ).catch(() => undefined);
  }
  if (error instanceof ApiError && error.status === 502) {
    await storeAttemptResult(
      attemptId,
      'failed',
      502,
      { error: { code: error.code, message: error.publicMessage } },
      {},
    ).catch(() => undefined);
    return;
  }
  await query('DELETE FROM payment_attempts WHERE id = $1', [attemptId]).catch(() => undefined);
}

/** The confirmed deposit turns the hold into the booked install day. */
async function bookDepositDay(
  commission: CommissionRow,
  payment: { killbillPaymentId: string },
): Promise<void> {
  const hold = await latestHold(commission.id);
  if (!hold) return;
  const venue = venueOf(commission);
  const quote = await currentQuote(commission.id);

  const dayId = await withTransaction(async (tx) => {
    const id = await bookHold(tx, hold, venue);
    await queueCrewAlert(tx, {
      commissionId: commission.id,
      commissionTitle: commission.title,
      installDayId: id,
      kind: 'slot_confirmed',
      venue,
      date: hold.hold_date,
    });
    await queueCrewAlert(tx, {
      commissionId: commission.id,
      commissionTitle: commission.title,
      installDayId: id,
      kind: 'load_in_tomorrow',
      venue,
      date: hold.hold_date,
      sendAt: loadInAlertInstant(hold.hold_date, venue),
    });
    const contract = await tx.query<{ id: string; sha256: string | null }>(
      `SELECT id, sha256 FROM documents
        WHERE commission_id = $1 AND kind = 'contract'
        ORDER BY version DESC LIMIT 1`,
      [commission.id],
    );
    await queueCrmEvent(tx, {
      commissionId: commission.id,
      clientId: commission.client_id,
      type: 'contract.signed',
      data: {
        signedAt: commission.signed_at ? isoUtc(commission.signed_at) : isoUtc(new Date()),
        signatureName: commission.signature_name,
        contractDocumentId: contract.rows[0]?.id ?? null,
        contractSha256: contract.rows[0]?.sha256 ?? null,
        depositKillbillPaymentId: payment.killbillPaymentId,
      },
    });
    return id;
  });
  void dayId;
  void quote;
  await advanceState(commission.id, 'held', 'contracted');
}

checkoutRouter.post(
  '/api/funders/:funderId/payments',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const { funder, commission } = await funderFor(pathParam(req, 'funderId'), caller);
    if (funder.accepted_user_id !== caller.user.id) throw notFound();

    const key = req.header('idempotency-key');
    const body = bodyObject(req);
    const path = `/api/funders/${funder.id}/payments`;

    if (key === undefined) {
      if (funder.state === 'paid') throw new ApiError(409, 'already_paid');
      if (commission.state === 'cancelled') throw new ApiError(409, 'commission_cancelled');
      validatePaymentBody(key, body);
      return;
    }

    const claimed = await claimAttempt({
      userId: caller.user.id,
      key,
      path,
      fingerprint: fingerprintOf(body),
      targetKind: 'funder',
      targetId: funder.id,
    });
    if (claimed.replay) {
      res.status(claimed.replay.status).json(claimed.replay.body);
      return;
    }

    try {
      if (funder.state === 'paid') throw new ApiError(409, 'already_paid');
      if (commission.state === 'cancelled') throw new ApiError(409, 'commission_cancelled');
      const card = validatePaymentBody(key, body);
      if (!funder.killbill_invoice_id || !funder.killbill_invoice_number) throw illegalState();

      const payer = await payerAccount(caller.user.id);
      const charged = await chargeInvoice(
        payer,
        {
          killbillInvoiceId: funder.killbill_invoice_id,
          invoiceNumber: funder.killbill_invoice_number,
          subtotalCents: funder.subtotal_cents,
          taxCents: funder.tax_cents,
          amountCents: funder.amount_cents,
        },
        key,
      );
      await recordSharePayment({ commission, funder, payer, payment: charged.payment });
      await storeAttemptResult(claimed.attemptId, 'paid', 201, { ...charged.response }, {
        lastFour: card.lastFour,
        killbillPaymentId: charged.payment.killbillPaymentId,
      });
      res.status(201).json(charged.response);
    } catch (error) {
      await markAttemptFailed(claimed.attemptId, null, error);
      throw error;
    }
  }),
);

export { serviceDown, findCommission, isoWithVenueOffset };
