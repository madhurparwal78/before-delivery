import { one, pool, withTransaction } from '../db/pool.js';
import { enrolmentJson, getEnrolment } from '../data/enrolments.js';
import {
  getRefundRequest,
  getRefundRequestForUpdate,
  listRefundRequests,
  refundAmountsForEnrolment,
  refundRequestJson,
} from '../data/refunds.js';
import { hasFinishedActivity } from '../domain/enrolment.js';
import type { RefundAmounts } from '../domain/refund.js';
import { conflict, notFound, Validator } from '../http/errors.js';
import { param, requireUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { refundOnce } from '../services/killbill.js';

const NOTE_MESSAGE = 'Keep the note to 500 characters or fewer.';

function readNote(ctx: RequestContext): string | null {
  const validator = new Validator(ctx.body, ['note']);
  const raw = ctx.body?.['note'];
  const note = typeof raw === 'string' ? raw.trim() : null;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') validator.add('note', NOTE_MESSAGE);
  if (note !== null && note.length > 500) validator.add('note', NOTE_MESSAGE);
  validator.throwIfInvalid();
  return note === null || note === '' ? null : note;
}

async function listQueue(ctx: RequestContext): Promise<Reply> {
  const rows = await listRefundRequests(pool);
  const refundRequests = [];
  for (const row of rows) refundRequests.push(await refundRequestJson(pool, row, ctx.at));
  return { status: 200, json: { refund_requests: refundRequests } };
}

interface PaymentRow {
  readonly party: string;
  readonly killbill_payment_id: string;
}

async function paymentOf(enrolmentId: string, party: 'employer' | 'learner'): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    pool,
    'SELECT party, killbill_payment_id FROM payments WHERE enrolment_id = $1 AND party = $2',
    [enrolmentId, party],
  );
}

/**
 * The employer refund is recorded first, then the learner refund, each only if non-zero
 * and each keyed to the request so a retried approval never refunds twice.
 */
async function recordRefunds(
  requestId: string,
  enrolmentId: string,
  amounts: RefundAmounts,
  plannerId: string,
  markFixed: () => Promise<void>,
): Promise<void> {
  const parties: readonly { party: 'employer' | 'learner'; amount: number }[] = [
    { party: 'employer', amount: amounts.employerRefundCents },
    { party: 'learner', amount: amounts.learnerRefundCents },
  ];
  for (const entry of parties) {
    if (entry.amount === 0) continue;
    const payment = await paymentOf(enrolmentId, entry.party);
    if (payment === null) throw new Error(`A ${entry.party} refund needs its original payment`);
    await refundOnce({
      paymentId: payment.killbill_payment_id,
      amountCents: entry.amount,
      transactionExternalKey: `refund-${requestId}-${entry.party}`,
      reasonCode: 'refund_request',
      comment: requestId,
      actingUserId: plannerId,
    });
    await markFixed();
  }
}

async function approveRefund(ctx: RequestContext): Promise<Reply> {
  const planner = requireUser(ctx);
  const request = await getRefundRequest(pool, param(ctx, 'id'));
  if (request === null) throw notFound();
  if (request.state !== 'pending') throw conflict('request_closed');

  const enrolment = await getEnrolment(pool, request.enrolment_id);
  if (enrolment === null) throw new Error('A refund request always has an enrolment');
  if (hasFinishedActivity(enrolment.state)) throw conflict('already_certified');
  const note = readNote(ctx);

  const amounts =
    request.amounts_fixed &&
    request.refund_total_cents !== null &&
    request.employer_refund_cents !== null &&
    request.learner_refund_cents !== null
      ? {
          refundTotalCents: request.refund_total_cents,
          employerRefundCents: request.employer_refund_cents,
          learnerRefundCents: request.learner_refund_cents,
        }
      : await refundAmountsForEnrolment(pool, enrolment, ctx.at);

  const markFixed = async (): Promise<void> => {
    await pool.query(
      `UPDATE refund_requests
       SET amounts_fixed = true, refund_total_cents = $2, employer_refund_cents = $3, learner_refund_cents = $4
       WHERE id = $1 AND amounts_fixed = false`,
      [request.id, amounts.refundTotalCents, amounts.employerRefundCents, amounts.learnerRefundCents],
    );
  };
  await recordRefunds(request.id, enrolment.id, amounts, planner.id, markFixed);

  const json = await withTransaction(async (client) => {
    const locked = await getRefundRequestForUpdate(client, request.id);
    if (locked === null) throw notFound();
    if (locked.state !== 'pending') throw conflict('request_closed');
    await client.query(
      `UPDATE refund_requests
       SET state = 'approved', amounts_fixed = true,
           refund_total_cents = $2, employer_refund_cents = $3, learner_refund_cents = $4,
           decided_by = $5, decided_at = now(), decision_note = $6
       WHERE id = $1`,
      [
        request.id,
        amounts.refundTotalCents,
        amounts.employerRefundCents,
        amounts.learnerRefundCents,
        planner.id,
        note,
      ],
    );
    await client.query(`UPDATE enrolments SET state = 'refunded' WHERE id = $1`, [enrolment.id]);
    const decided = await getRefundRequest(client, request.id);
    const refreshed = await getEnrolment(client, enrolment.id);
    if (decided === null || refreshed === null) throw new Error('The decided refund vanished');
    return {
      refund_request: await refundRequestJson(client, decided, ctx.at),
      enrolment: await enrolmentJson(client, refreshed),
    };
  });
  return { status: 200, json };
}

async function declineRefund(ctx: RequestContext): Promise<Reply> {
  const planner = requireUser(ctx);
  const request = await getRefundRequest(pool, param(ctx, 'id'));
  if (request === null) throw notFound();
  if (request.state !== 'pending') throw conflict('request_closed');
  const note = readNote(ctx);

  const json = await withTransaction(async (client) => {
    const locked = await getRefundRequestForUpdate(client, request.id);
    if (locked === null) throw notFound();
    if (locked.state !== 'pending') throw conflict('request_closed');
    const enrolment = await getEnrolment(client, locked.enrolment_id);
    if (enrolment === null) throw new Error('A refund request always has an enrolment');
    const amounts = await refundAmountsForEnrolment(client, enrolment, ctx.at);
    await client.query(
      `UPDATE refund_requests
       SET state = 'declined', amounts_fixed = true,
           refund_total_cents = $2, employer_refund_cents = $3, learner_refund_cents = $4,
           decided_by = $5, decided_at = now(), decision_note = $6
       WHERE id = $1`,
      [
        locked.id,
        amounts.refundTotalCents,
        amounts.employerRefundCents,
        amounts.learnerRefundCents,
        planner.id,
        note,
      ],
    );
    const decided = await getRefundRequest(client, locked.id);
    if (decided === null) throw new Error('The declined refund vanished');
    return { refund_request: await refundRequestJson(client, decided, ctx.at) };
  });
  return { status: 200, json };
}

export const refundRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/refund-requests', auth: 'required', roles: ['planner'], handler: listQueue },
  {
    method: 'POST',
    path: '/api/refund-requests/:id/approve',
    auth: 'required',
    roles: ['planner'],
    handler: approveRefund,
  },
  {
    method: 'POST',
    path: '/api/refund-requests/:id/decline',
    auth: 'required',
    roles: ['planner'],
    handler: declineRefund,
  },
];
