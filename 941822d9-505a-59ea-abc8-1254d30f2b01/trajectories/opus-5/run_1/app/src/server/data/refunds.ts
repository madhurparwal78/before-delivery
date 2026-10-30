import { one, query, type Queryable } from '../db/pool.js';
import { computeRefund, type RefundAmounts } from '../domain/refund.js';
import { formatMoney } from '../domain/money.js';
import { instantToIso } from '../domain/providerTime.js';
import { config } from '../config.js';
import { getEnrolment, verifiedMinutes, type EnrolmentRow } from './enrolments.js';

export interface RefundRequestRow {
  readonly id: string;
  readonly enrolment_id: string;
  readonly reason: string;
  readonly state: 'pending' | 'approved' | 'declined';
  readonly requested_at: Date;
  readonly refund_total_cents: number | null;
  readonly employer_refund_cents: number | null;
  readonly learner_refund_cents: number | null;
  readonly amounts_fixed: boolean;
  readonly decided_by: string | null;
  readonly decided_at: Date | null;
  readonly decision_note: string | null;
  readonly nurse_name: string;
  readonly course_title: string;
  readonly decider_name: string | null;
}

const REFUND_SELECT = `
  SELECT r.id, r.enrolment_id, r.reason, r.state, r.requested_at,
         r.refund_total_cents, r.employer_refund_cents, r.learner_refund_cents, r.amounts_fixed,
         r.decided_by, r.decided_at, r.decision_note,
         u.display_name AS nurse_name, c.title AS course_title,
         d.display_name AS decider_name
  FROM refund_requests r
  JOIN enrolments e ON e.id = r.enrolment_id
  JOIN users u ON u.id = e.user_id
  JOIN courses c ON c.id = e.course_id
  LEFT JOIN users d ON d.id = r.decided_by
`;

export async function getRefundRequest(client: Queryable, id: string): Promise<RefundRequestRow | null> {
  return one<RefundRequestRow>(client, `${REFUND_SELECT} WHERE r.id = $1`, [id]);
}

export async function getRefundRequestForUpdate(
  client: Queryable,
  id: string,
): Promise<RefundRequestRow | null> {
  const locked = await one<{ id: string }>(client, 'SELECT id FROM refund_requests WHERE id = $1 FOR UPDATE', [id]);
  if (locked === null) return null;
  return getRefundRequest(client, id);
}

export async function listRefundRequests(client: Queryable): Promise<RefundRequestRow[]> {
  return query<RefundRequestRow>(
    client,
    `${REFUND_SELECT} ORDER BY (r.state = 'pending') DESC, r.requested_at DESC`,
  );
}

/** While a request is pending its amounts are what approving now would pay. */
export async function refundAmountsFor(
  client: Queryable,
  request: RefundRequestRow,
  at: Date,
): Promise<RefundAmounts> {
  if (
    request.amounts_fixed &&
    request.refund_total_cents !== null &&
    request.employer_refund_cents !== null &&
    request.learner_refund_cents !== null
  ) {
    return {
      refundTotalCents: request.refund_total_cents,
      employerRefundCents: request.employer_refund_cents,
      learnerRefundCents: request.learner_refund_cents,
    };
  }
  const enrolment = await getEnrolment(client, request.enrolment_id);
  if (enrolment === null) throw new Error('A refund request always has an enrolment');
  return refundAmountsForEnrolment(client, enrolment, at);
}

export async function refundAmountsForEnrolment(
  client: Queryable,
  enrolment: EnrolmentRow,
  at: Date,
): Promise<RefundAmounts> {
  const verified = await verifiedMinutes(client, enrolment);
  const totals = await one<{ total: string }>(
    client,
    'SELECT coalesce(sum(minutes), 0)::text AS total FROM course_modules WHERE course_id = $1',
    [enrolment.course_id],
  );
  const totalMinutes = totals === null ? 0 : Number.parseInt(totals.total, 10);
  return computeRefund({
    listPriceCents: enrolment.list_price_cents,
    employerShareCents: enrolment.employer_share_cents,
    totalMinutes,
    verifiedMinutes: verified,
    enrolledAt: enrolment.enrolled_at,
    at,
    fullRefundWindowSeconds: config.fullRefundWindowSeconds,
  });
}

export interface RefundRequestJson {
  readonly id: string;
  readonly enrolment_id: string;
  readonly nurse_name: string;
  readonly course_title: string;
  readonly state: 'pending' | 'approved' | 'declined';
  readonly reason: string;
  readonly requested_at: string;
  readonly refund_total: string;
  readonly employer_refund: string;
  readonly learner_refund: string;
  readonly decided_by: { id: string; display_name: string } | null;
  readonly decided_at: string | null;
  readonly decision_note: string | null;
}

export async function refundRequestJson(
  client: Queryable,
  request: RefundRequestRow,
  at: Date,
): Promise<RefundRequestJson> {
  const amounts = await refundAmountsFor(client, request, at);
  return {
    id: request.id,
    enrolment_id: request.enrolment_id,
    nurse_name: request.nurse_name,
    course_title: request.course_title,
    state: request.state,
    reason: request.reason,
    requested_at: instantToIso(request.requested_at),
    refund_total: formatMoney(amounts.refundTotalCents),
    employer_refund: formatMoney(amounts.employerRefundCents),
    learner_refund: formatMoney(amounts.learnerRefundCents),
    decided_by:
      request.decided_by === null || request.decider_name === null
        ? null
        : { id: request.decided_by, display_name: request.decider_name },
    decided_at: request.decided_at === null ? null : instantToIso(request.decided_at),
    decision_note: request.decision_note,
  };
}
