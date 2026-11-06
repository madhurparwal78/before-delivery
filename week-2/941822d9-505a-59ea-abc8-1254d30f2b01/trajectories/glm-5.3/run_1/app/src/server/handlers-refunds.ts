import { err, notFound, validationError } from "./errors.ts";
import { query, withTransaction } from "./db.ts";
import { PaymentsUnavailable, findPurchase, refund as kbRefund, transactionExists } from "./payments.ts";
import { refundAmounts } from "./refunds.ts";
import { serialiseEnrolment } from "./dto.ts";
import { loadEnrolment, enrolmentModules } from "./handlers-checkout.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam, type Ctx } from "./route.ts";

const NOTE_MESSAGE = "Keep the note to 500 characters or fewer.";

function parseNoteBody(body: unknown): { errors: Record<string, string>; note: string | null } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (key !== "note") errors[key] = "This field is not accepted.";
  }
  const noteRaw = raw.note;
  const note = noteRaw === undefined || noteRaw === null ? null : typeof noteRaw === "string" ? noteRaw : null;
  if (note !== null && note.length > 500) errors.note = NOTE_MESSAGE;
  return { errors, note };
}

export async function listRefundRequests(ctx: Ctx): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM refund_requests ORDER BY (state = 'pending') DESC, requested_at`,
  );
  const list = [];
  for (const r of rows) {
    const req = await loadRefundRow(r.id);
    if (req) list.push(req);
  }
  ctx.res.json({ refund_requests: list });
}

async function loadRefundRow(id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT r.id, r.enrolment_id, u.display_name AS nurse_name, co.title AS course_title, r.state, r.reason, r.requested_at,
            r.refund_total_cents, r.employer_refund_cents, r.learner_refund_cents,
            r.decided_by, du.display_name AS decided_by_name, r.decided_at, r.decision_note
       FROM refund_requests r
       JOIN enrolments e ON e.id = r.enrolment_id
       JOIN courses co ON co.id = e.course_id
       JOIN users u ON u.id = e.nurse_id
       LEFT JOIN users du ON du.id = r.decided_by
      WHERE r.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    enrolment_id: row.enrolment_id,
    nurse_name: row.nurse_name,
    course_title: row.course_title,
    state: row.state,
    reason: row.reason,
    requested_at: (row.requested_at as Date).toISOString(),
    refund_total: row.refund_total_cents === null ? null : ((row.refund_total_cents as number) / 100).toFixed(2),
    employer_refund: row.employer_refund_cents === null ? null : ((row.employer_refund_cents as number) / 100).toFixed(2),
    learner_refund: row.learner_refund_cents === null ? null : ((row.learner_refund_cents as number) / 100).toFixed(2),
    decided_by: row.decided_by === null ? null : { id: row.decided_by, display_name: row.decided_by_name },
    decided_at: row.decided_at === null ? null : (row.decided_at as Date).toISOString(),
    decision_note: row.decision_note,
  };
}

export async function approveRefund(ctx: Ctx): Promise<void> {
  const { errors, note } = parseNoteBody(ctx.body);
  const { rows } = await query<{
    id: string;
    enrolment_id: string;
    state: string;
    refund_total_cents: number | null;
    employer_refund_cents: number | null;
    learner_refund_cents: number | null;
  }>(
    `SELECT id, enrolment_id, state, refund_total_cents, employer_refund_cents, learner_refund_cents
       FROM refund_requests WHERE id = $1 FOR UPDATE`,
    [uuidOr404(pathParam(ctx, "id"))],
  );
  const request = rows[0];
  if (!request) throw notFound();
  if (request.state !== "pending") throw err(409, "request_closed");

  const enrolment = await loadEnrolment(request.enrolment_id);
  if (!enrolment) throw notFound();
  if (enrolment.state === "completed" || enrolment.state === "certified") {
    throw err(409, "already_certified");
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  // The three amounts are fixed once any refund for the request has been
  // recorded in Kill Bill; otherwise they are computed now.
  let amounts: { totalCents: number; employerCents: number; learnerCents: number };
  if (request.refund_total_cents !== null && request.employer_refund_cents !== null && request.learner_refund_cents !== null) {
    amounts = {
      totalCents: request.refund_total_cents,
      employerCents: request.employer_refund_cents,
      learnerCents: request.learner_refund_cents,
    };
  } else {
    amounts = refundAmounts({
      listPriceCents: enrolment.list_price_cents,
      employerShareCents: enrolment.employer_share_cents,
      totalMinutes: enrolment.total_minutes,
      verifiedMinutes: enrolment.verified_minutes,
      enrolledAt: new Date(enrolment.enrolled_at),
      approvalInstant: new Date(),
    });
  }

  const enrolmentId = enrolment.id;
  const requestId = request.id;
  const plannerId = ctx.user.id;
  try {
    for (const side of ["employer", "learner"] as const) {
      const amount = side === "employer" ? amounts.employerCents : amounts.learnerCents;
      if (amount <= 0) continue;
      const paymentKey = `enrol-${enrolmentId}-${side}`;
      const refundKey = `refund-${requestId}-${side}`;
      const purchaseInfo = await findPurchase(paymentKey, plannerId);
      if (!purchaseInfo) throw new PaymentsUnavailable("original payment missing");
      if (await transactionExists(refundKey, plannerId)) continue;
      await kbRefund(purchaseInfo.paymentId, amount, refundKey, "refund_request", requestId, plannerId);
    }
  } catch (e) {
    if (e instanceof PaymentsUnavailable) throw err(503, "payments_unavailable");
    throw e;
  }

  // The decision is written once: the guarded update loses to any earlier
  // decision, which answers request_closed.
  const { rows: decided } = await query<{ id: string }>(
    `UPDATE refund_requests SET state = 'approved', refund_total_cents = $2, employer_refund_cents = $3,
            learner_refund_cents = $4, decided_by = $5, decided_at = now(), decision_note = $6
      WHERE id = $1 AND state = 'pending' RETURNING id`,
    [requestId, amounts.totalCents, amounts.employerCents, amounts.learnerCents, plannerId, note],
  );
  if (decided.length === 0) throw err(409, "request_closed");
  await query(`UPDATE enrolments SET state = 'refunded' WHERE id = $1 AND state = 'confirmed'`, [enrolmentId]);

  const freshRequest = await loadRefundRow(requestId);
  if (!freshRequest) throw notFound();
  const freshEnrolment = await loadEnrolment(enrolmentId);
  if (!freshEnrolment) throw notFound();
  ctx.res.json({
    refund_request: freshRequest,
    enrolment: serialiseEnrolment(freshEnrolment, await enrolmentModules(enrolmentId)),
  });
}

export async function declineRefund(ctx: Ctx): Promise<void> {
  const { errors, note } = parseNoteBody(ctx.body);
  const { rows } = await query<{ id: string; state: string }>(
    `SELECT id, state FROM refund_requests WHERE id = $1 FOR UPDATE`,
    [uuidOr404(pathParam(ctx, "id"))],
  );
  const request = rows[0];
  if (!request) throw notFound();
  if (request.state !== "pending") throw err(409, "request_closed");
  if (Object.keys(errors).length > 0) throw validationError(errors);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE refund_requests SET state = 'declined', decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $1 AND state = 'pending'`,
      [request.id, ctx.user.id, note],
    );
  });
  const fresh = await loadRefundRow(request.id);
  if (!fresh) throw notFound();
  ctx.res.json({ refund_request: fresh });
}
