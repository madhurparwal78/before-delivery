import { randomUUID } from "node:crypto";
import { db, isUniqueViolation, one, tx, withLock } from "../db.js";
import { config } from "../config.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import { refundOnce } from "../services/killbill.js";
import { formatMoney, quotient } from "./amounts.js";
import { isId } from "./courses.js";
import { enrolmentJson, enrolmentRow, readableEnrolment, type EnrolmentRow } from "./enrolments.js";
import type { SessionUser } from "./users.js";

interface RefundAmounts {
  totalCents: number;
  employerCents: number;
  learnerCents: number;
}

/**
 * The refund rule: the full list price inside the full-refund window with under 25% of minutes verified; otherwise
 * the list price × unfinished minutes / total minutes, rounded down. Split in the ratio of the original shares.
 */
function refundAmounts(e: Pick<EnrolmentRow, "list_price_cents" | "employer_share_cents" | "enrolled_at" | "verified_minutes" | "total_minutes">, at: Date): RefundAmounts {
  const inWindow = at.getTime() < e.enrolled_at.getTime() + config.clock.fullRefundWindowMs;
  const totalCents =
    inWindow && e.verified_minutes * 4 < e.total_minutes
      ? e.list_price_cents
      : quotient(e.list_price_cents * (e.total_minutes - e.verified_minutes), e.total_minutes);
  const employerCents = e.list_price_cents === 0 ? 0 : quotient(totalCents * e.employer_share_cents, e.list_price_cents);
  return { totalCents, employerCents, learnerCents: totalCents - employerCents };
}

interface RequestRow {
  id: string;
  enrolment_id: string;
  state: "pending" | "approved" | "declined";
  reason: string;
  requested_at: Date;
  fixed_total_cents: number | null;
  fixed_employer_cents: number | null;
  fixed_learner_cents: number | null;
  decided_by: string | null;
  decider_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  nurse_name: string;
  learner_id: string;
}

const REQUEST_SELECT = `
  SELECT r.id, r.enrolment_id, r.state, r.reason, r.requested_at, r.fixed_total_cents, r.fixed_employer_cents,
         r.fixed_learner_cents, r.decided_by, d.display_name AS decider_name, r.decided_at, r.decision_note,
         n.display_name AS nurse_name, e.learner_id
    FROM refund_requests r JOIN enrolments e ON e.id = r.enrolment_id JOIN users n ON n.id = e.learner_id
    LEFT JOIN users d ON d.id = r.decided_by`;

const fixedAmounts = (r: RequestRow): RefundAmounts | null =>
  r.fixed_total_cents !== null && r.fixed_employer_cents !== null && r.fixed_learner_cents !== null
    ? { totalCents: r.fixed_total_cents, employerCents: r.fixed_employer_cents, learnerCents: r.fixed_learner_cents }
    : null;

/** Fixed amounts once any refund was recorded or the request was decided; otherwise what approving now would pay. */
const amountsOf = (r: RequestRow, e: EnrolmentRow, at: Date): RefundAmounts => fixedAmounts(r) ?? refundAmounts(e, at);

async function requestJson(r: RequestRow, at: Date): Promise<Record<string, unknown>> {
  const e = await enrolmentRow(db, r.enrolment_id);
  if (!e) throw notFound();
  const amounts = amountsOf(r, e, at);
  return {
    id: r.id,
    enrolment_id: r.enrolment_id,
    nurse_name: r.nurse_name,
    course_title: e.course_title,
    state: r.state,
    reason: r.reason,
    requested_at: r.requested_at.toISOString(),
    refund_total: formatMoney(amounts.totalCents),
    employer_refund: formatMoney(amounts.employerCents),
    learner_refund: formatMoney(amounts.learnerCents),
    decided_by: r.decided_by !== null && r.decider_name !== null ? { id: r.decided_by, display_name: r.decider_name } : null,
    decided_at: r.decided_at?.toISOString() ?? null,
    decision_note: r.decision_note,
  };
}

const requestRow = (id: string): Promise<RequestRow | undefined> => one<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1`, [id]);

export async function requestRefund(learner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const e = await readableEnrolment(db, learner, id);
  if (e.learner_id !== learner.id) throw forbidden();
  if (e.state === "completed" || e.state === "certified") throw conflict("already_certified");
  if (e.funding === "seat" || e.state !== "confirmed") throw conflict("not_refundable");
  if (await one(db, "SELECT 1 FROM refund_requests WHERE enrolment_id = $1 AND state = 'pending'", [e.id])) throw conflict("refund_pending");
  const v = new Validation(body, ["reason"]);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) v.add("reason", "Tell the planner why you are asking for a refund.");
  v.done();
  const requestId = randomUUID();
  try {
    await db.q("INSERT INTO refund_requests (id, enrolment_id, state, reason, requested_at) VALUES ($1, $2, 'pending', $3, $4)", [requestId, e.id, reason, at]);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("refund_pending");
    throw error;
  }
  const row = await requestRow(requestId);
  if (!row) throw notFound();
  return requestJson(row, at);
}

export async function refundQueue(at: Date): Promise<Record<string, unknown>[]> {
  const rows = await db.q<RequestRow>(`${REQUEST_SELECT} ORDER BY (r.state = 'pending') DESC, r.requested_at DESC`);
  const out: Record<string, unknown>[] = [];
  for (const row of rows) out.push(await requestJson(row, at));
  return out;
}

/** The planner reads every request and the requesting learner their own; anyone else gets 404. */
async function decidable(viewer: SessionUser, id: unknown): Promise<RequestRow> {
  const row = isId(id) ? await requestRow(id) : undefined;
  if (!row || (viewer.role !== "planner" && row.learner_id !== viewer.id)) throw notFound();
  if (viewer.role !== "planner") throw forbidden();
  return row;
}

function noteOf(body: Record<string, unknown>, v: Validation): string | null {
  const note = body.note;
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 500)) v.add("note", "Keep the note to 500 characters or fewer.");
  return typeof note === "string" && note.trim() !== "" ? note.trim() : null;
}

/**
 * Approves a refund: each side's Kill Bill refund (keyed to the request, so a retry never refunds twice), then the
 * decision and the refunded enrolment in one transaction. If Kill Bill fails, Credwell changes nothing.
 */
export async function approveRefund(planner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const known = await decidable(planner, id);
  return withLock(`refund:${known.id}`, async () => {
    const r = (await requestRow(known.id)) ?? known;
    if (r.state !== "pending") throw conflict("request_closed");
    const e = await enrolmentRow(db, r.enrolment_id);
    if (!e) throw notFound();
    if (e.state === "completed" || e.state === "certified") throw conflict("already_certified");
    const v = new Validation(body, ["note"]);
    const note = noteOf(body, v);
    v.done();
    const amounts = amountsOf(r, e, at);
    const sides = [
      { side: "employer", cents: amounts.employerCents },
      { side: "learner", cents: amounts.learnerCents },
    ] as const;
    for (const { side, cents } of sides) {
      if (cents === 0) continue;
      await refundOnce(`enrol-${e.id}-${side}`, `refund-${r.id}-${side}`, cents, { actor: planner.id, reason: "refund_request", comment: r.id });
      await db.q(
        `UPDATE refund_requests SET fixed_total_cents = $2, fixed_employer_cents = $3, fixed_learner_cents = $4
          WHERE id = $1 AND fixed_total_cents IS NULL`,
        [r.id, amounts.totalCents, amounts.employerCents, amounts.learnerCents],
      );
    }
    await tx(async (t) => {
      await t.q(
        `UPDATE refund_requests SET state = 'approved', decided_by = $2, decided_at = $3, decision_note = $4,
                fixed_total_cents = $5, fixed_employer_cents = $6, fixed_learner_cents = $7 WHERE id = $1 AND state = 'pending'`,
        [r.id, planner.id, at, note, amounts.totalCents, amounts.employerCents, amounts.learnerCents],
      );
      await t.q("UPDATE enrolments SET state = 'refunded' WHERE id = $1 AND state = 'confirmed'", [e.id]);
    });
    const decided = (await requestRow(r.id)) ?? r;
    return { refund_request: await requestJson(decided, at), enrolment: await enrolmentJson(db, e.id) };
  });
}

export async function declineRefund(planner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const known = await decidable(planner, id);
  return withLock(`refund:${known.id}`, async () => {
    const r = (await requestRow(known.id)) ?? known;
    if (r.state !== "pending") throw conflict("request_closed");
    const v = new Validation(body, ["note"]);
    const note = noteOf(body, v);
    v.done();
    const e = await enrolmentRow(db, r.enrolment_id);
    if (!e) throw notFound();
    const amounts = amountsOf(r, e, at);
    await db.q(
      `UPDATE refund_requests SET state = 'declined', decided_by = $2, decided_at = $3, decision_note = $4,
              fixed_total_cents = $5, fixed_employer_cents = $6, fixed_learner_cents = $7 WHERE id = $1 AND state = 'pending'`,
      [r.id, planner.id, at, note, amounts.totalCents, amounts.employerCents, amounts.learnerCents],
    );
    const decided = (await requestRow(r.id)) ?? r;
    return { refund_request: await requestJson(decided, at) };
  });
}
