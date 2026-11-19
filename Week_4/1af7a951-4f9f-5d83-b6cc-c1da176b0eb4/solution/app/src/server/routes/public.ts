import type { Enrollment } from "../../shared/api.js";
import { digest, newSecret } from "../codes.js";
import { acceptsEnrollment } from "../domain/cohorts.js";
import { ACCEPTED_TIME_ZONES, derivedNightKey } from "../domain/time.js";
import { enrollmentErrors, isUuid } from "../domain/validation.js";
import { isUniqueViolation, pool, transaction, type Db } from "../db.js";
import { fail, invalid, notFound, ok } from "../http.js";
import { open, withoutBody, type Route } from "../router.js";
import { chargeSeat } from "../services/killbill.js";
import { deliverReceipt } from "../services/mail.js";
import { COHORT_SELECT, ENROLLMENT_SELECT, phaseOf, seatsLeft, toCohort, toEnrollment, type CohortRow, type EnrollmentRow } from "../views.js";

async function enrollment(id: string, db: Db = pool): Promise<EnrollmentRow> {
  if (!isUuid(id)) throw notFound();
  const found = await db.query<EnrollmentRow>(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [id]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

async function cohort(id: string, db: Db = pool): Promise<CohortRow> {
  const found = await db.query<CohortRow>(`${COHORT_SELECT} WHERE c.id = $1`, [id]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export const publicRoutes: Route[] = [
  open("GET", /^\/api\/health$/, async () => ok({ status: "ok" })),

  open("GET", /^\/api\/time-zones$/, async () => ok({ zones: ACCEPTED_TIME_ZONES })),

  open("GET", /^\/api\/cohorts$/, async ({ now }) => {
    const rows = await pool.query<CohortRow>(`${COHORT_SELECT} ORDER BY c.starts_on, c.name`);
    const cohorts = rows.rows.map((row) => toCohort(row, now)).filter((c) => acceptsEnrollment(c.phase));
    return ok({ cohorts });
  }),

  open("GET", /^\/api\/cohorts\/([^/]+)$/, async ({ params, now }) => {
    if (!isUuid(params[0])) throw notFound();
    const found = await cohort(params[0]);
    if (!found.published) throw notFound();
    return ok({ cohort: toCohort(found, now) });
  }),

  open("POST", /^\/api\/enrollments$/, async ({ body, now }) => {
    if (!isUuid(body.cohort_id)) throw notFound();
    const target = await cohort(body.cohort_id);
    const { phase } = phaseOf(target, now);
    if (phase === "draft") throw notFound();
    if (!acceptsEnrollment(phase)) throw fail(409, "enrollment_closed");
    if (typeof body.email === "string") {
      const taken = await pool.query(
        "SELECT 1 FROM enrollments WHERE cohort_id = $1 AND lower(email) = lower($2) AND status IN ('pending_payment', 'active')",
        [target.id, body.email],
      );
      if (taken.rowCount) throw fail(409, "already_enrolled");
    }
    const errors = enrollmentErrors(body);
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const code = newSecret();
    try {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO enrollments (cohort_id, name, email, home_tz, bedtime, status, access_code_hash, receipt_access_code)
         VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6, $7) RETURNING id`,
        [target.id, body.name, body.email, body.home_tz, body.bedtime, digest(code), code],
      );
      const made = await enrollment(created.rows[0]?.id ?? "");
      return ok({ enrollment: toEnrollment(made), access_code: code }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) throw fail(409, "already_enrolled");
      throw error;
    }
  }),

  open("GET", /^\/api\/enrollments\/([^/]+)$/, async ({ params }) => ok({ enrollment: toEnrollment(await enrollment(params[0] ?? "")) })),

  withoutBody(open("POST", /^\/api\/enrollments\/([^/]+)\/pay$/, async ({ params, now }) => {
    const id = params[0] ?? "";
    await enrollment(id);
    const activated = await transaction(async (client) => {
      const current = await client.query<{ cohort_id: string }>("SELECT cohort_id FROM enrollments WHERE id = $1", [id]);
      // The per-cohort lock, held through the Kill Bill call: concurrent payers for the last seat queue here.
      await client.query("SELECT id FROM cohorts WHERE id = $1 FOR UPDATE", [current.rows[0]?.cohort_id]);
      const seat = await enrollment(id, client);
      if (seat.status === "active") return false;
      if (seat.status === "refunded") throw fail(409, "illegal_transition", { from: "refunded", to: "active" });
      const target = await cohort(seat.cohort_id, client);
      const { phase } = phaseOf(target, now);
      if (!acceptsEnrollment(phase)) throw fail(409, "enrollment_closed");
      if (seatsLeft(target) <= 0) throw fail(409, "cohort_full");
      const charge = await chargeSeat({ id, name: seat.name, email: seat.email, priceCents: target.price_cents });
      if (!charge.charged) throw fail(402, "payment_declined");
      // A new enrolment has no entries yet, so its night key is the derived one.
      const tonight = derivedNightKey(now, seat.home_tz, seat.bedtime);
      const firstNight = tonight > target.starts_on ? tonight : target.starts_on;
      await client.query(
        `UPDATE enrollments SET status = 'active', first_night = $2, receipt_status = 'pending',
                killbill_payment_id = $3, amount_paid_cents = $4
          WHERE id = $1`,
        [id, firstNight, charge.paymentId, charge.amountCents],
      );
      return true;
    });
    if (activated) await deliverReceipt(id);
    const paid: Enrollment = toEnrollment(await enrollment(id));
    return ok({ enrollment: paid });
  })),
];
