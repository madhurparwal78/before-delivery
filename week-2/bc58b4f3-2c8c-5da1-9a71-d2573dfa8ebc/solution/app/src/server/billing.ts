// Charges, invoice posting to Kill Bill (with the queued retry), the billing queue and dated rate cards.
import { DateTime } from "luxon";
import { AGENCY_ZONE, toAgencyIso } from "../shared/time.js";
import { requireRole } from "./auth.js";
import { billingFrom, billingView, chargesFor } from "./charges.js";
import { config } from "./config.js";
import { type Db, pool, transaction } from "./db.js";
import { ApiError, type FieldErrors, type Reply, type SignedInContext, route } from "./http.js";
import { KillBillUnreachable, postExternalCharge } from "./killbill.js";
import { type AssignmentRecord, loadAssignments, reloadAssignment } from "./records.js";
import { asObject, isInteger } from "./validation.js";
import { visibleAssignment } from "./views.js";

async function getCharges(ctx: SignedInContext): Promise<Reply> {
  const { record } = await visibleAssignment(ctx.session.person, ctx.params.number ?? "");
  requireRole(ctx, "billing_lead");
  return { status: 200, json: await chargesFor(record) };
}

/**
 * Post one billable assignment under its row lock: exactly one Kill Bill external charge, whatever the number
 * of requests, retries or instances. Returns the billing status reached.
 */
async function post(db: Db, record: AssignmentRecord, actorId: string | null): Promise<"posted" | "queued"> {
  const charges = await chargesFor(record, db);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`killbill-account-${record.orgCode}`]);
  const description = `${record.number} ${charges.kind === "service" ? "service" : "late cancellation"}`;
  try {
    const invoiceId = await postExternalCharge({ code: record.orgCode, name: record.orgName }, description, charges.total_cents);
    await db.query(
      `UPDATE assignments SET billing_status = 'posted', invoice_id = $2, billed_charges = $3,
              status = CASE WHEN status = 'verified' THEN 'invoiced' ELSE status END
        WHERE id = $1`,
      [record.id, invoiceId, JSON.stringify(charges)],
    );
    await db.query("INSERT INTO audit_log (actor_id, action, assignment_id, detail) VALUES ($1, 'invoice_posted', $2, $3)", [
      actorId,
      record.id,
      JSON.stringify({ invoice_id: invoiceId, total_cents: charges.total_cents }),
    ]);
    return "posted";
  } catch (error) {
    if (!(error instanceof KillBillUnreachable)) throw error;
    if (record.billingStatus !== "queued") {
      await db.query("UPDATE assignments SET billing_status = 'queued', billed_charges = $2 WHERE id = $1", [
        record.id,
        JSON.stringify(charges),
      ]);
      await db.query("INSERT INTO audit_log (actor_id, action, assignment_id, detail) VALUES ($1, 'invoice_queued', $2, $3)", [
        actorId,
        record.id,
        JSON.stringify({ total_cents: charges.total_cents, reason: error.message }),
      ]);
    }
    return "queued";
  }
}

async function postInvoice(ctx: SignedInContext): Promise<Reply> {
  return transaction(async (db) => {
    const { record } = await visibleAssignment(ctx.session.person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "billing_lead");
    if (record.billingStatus === "posted") return { status: 200, json: { billing: await billingView(record, db) } };
    const reached = await post(db, record, ctx.session.person.id);
    const billing = await billingView(await reloadAssignment(db, record.id), db);
    return { status: reached === "posted" ? 201 : 202, json: { billing } };
  });
}

/** Retry queued posts in the background until Kill Bill answers again. */
async function retryQueued(): Promise<void> {
  let more = true;
  while (more) {
    more = await transaction(async (db) => {
      const [record] = await loadAssignments(
        "a.id = (SELECT id FROM assignments WHERE billing_status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)",
        [],
        db,
      );
      if (!record) return false;
      return (await post(db, record, null)) === "posted";
    });
  }
}

export function startBillingRetry(): void {
  setInterval(() => {
    retryQueued().catch((error: unknown) => console.warn(`Billing retry failed: ${String(error)}`));
  }, config.billingRetrySeconds * 1000).unref();
}

async function billingQueue(ctx: SignedInContext): Promise<Reply> {
  requireRole(ctx, "billing_lead");
  const records = await loadAssignments("a.billing_status IN ('ready','queued','posted')", []);
  const items = await Promise.all(
    records.map(async (record) => {
      const charges = await chargesFor(record);
      const billing = billingFrom(record, charges);
      return {
        number: record.number,
        org_code: record.orgCode,
        kind: charges.kind,
        start_at: toAgencyIso(DateTime.fromJSDate(record.startAt)),
        total_cents: billing.total_cents,
        billing,
      };
    }),
  );
  return { status: 200, json: { items } };
}

interface RateRow {
  org: string;
  service_line: "asl" | "spoken";
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

const RATE_COLUMNS =
  "org_code AS org, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile";

async function knownOrganisation(code: unknown): Promise<string> {
  const found = typeof code === "string" ? await pool.query("SELECT 1 FROM organisations WHERE code = $1", [code]) : null;
  if (!found?.rowCount) throw new ApiError("not_found");
  return code as string;
}

async function listRates(ctx: SignedInContext): Promise<Reply> {
  const org = await knownOrganisation(ctx.query.get("org"));
  requireRole(ctx, "billing_lead");
  const rows = await pool.query<RateRow>(
    `SELECT ${RATE_COLUMNS} FROM rate_cards WHERE org_code = $1 ORDER BY effective_from, service_line`,
    [org],
  );
  return { status: 200, json: { entries: rows.rows } };
}

async function addRate(ctx: SignedInContext): Promise<Reply> {
  const body = asObject(ctx.body) ?? {};
  const org = await knownOrganisation(body.org);
  const person = requireRole(ctx, "billing_lead");
  const line = body.service_line;
  const effective = typeof body.effective_from === "string" ? DateTime.fromISO(body.effective_from, { zone: AGENCY_ZONE }) : null;
  const effectiveDate =
    effective?.isValid && /^\d{4}-\d{2}-\d{2}$/.test(String(body.effective_from)) ? effective.toISODate() : null;
  return transaction(async (db) => {
    if ((line === "asl" || line === "spoken") && effectiveDate) {
      const duplicate = await db.query(
        "SELECT 1 FROM rate_cards WHERE org_code = $1 AND service_line = $2 AND effective_from = $3",
        [org, line, effectiveDate],
      );
      if (duplicate.rowCount) throw new ApiError("duplicate_rate");
    }
    const errors: FieldErrors = {};
    if (line !== "asl" && line !== "spoken") errors.service_line = "Choose ASL or Spoken.";
    const today = DateTime.now().setZone(AGENCY_ZONE).toISODate() ?? "";
    if (!effectiveDate) errors.effective_from = "Enter a date as YYYY-MM-DD.";
    else if (effectiveDate <= today) errors.effective_from = "Choose a date after today (Central time).";
    const hourly = body.hourly_rate_cents;
    if (!isInteger(hourly) || hourly < 1 || hourly > 1_000_000) {
      errors.hourly_rate_cents = "Enter an hourly rate from $0.01 to $10,000.00.";
    }
    const mileage = body.mileage_cents_per_mile;
    if (!isInteger(mileage) || mileage < 0 || mileage > 1000) {
      errors.mileage_cents_per_mile = "Enter whole cents per mile, from 0 to 1,000.";
    }
    if (Object.keys(errors).length > 0) throw new ApiError("validation", errors);
    // The unique key decides a race between identical entries: the second insert adds nothing and is a duplicate.
    const inserted = await db.query<RateRow>(
      `INSERT INTO rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_code, service_line, effective_from) DO NOTHING RETURNING ${RATE_COLUMNS}`,
      [org, line, effectiveDate, hourly, mileage],
    );
    if (inserted.rowCount === 0) throw new ApiError("duplicate_rate");
    await db.query("INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, 'rate_entry', $2)", [
      person.id,
      JSON.stringify(inserted.rows[0]),
    ]);
    return { status: 201, json: inserted.rows[0] };
  });
}

export function registerBillingRoutes(): void {
  route("GET", "/api/assignments/{number}/charges", getCharges);
  route("POST", "/api/assignments/{number}/invoice", postInvoice);
  route("GET", "/api/billing/queue", billingQueue);
  route("GET", "/api/rate-cards", listRates);
  route("POST", "/api/rate-cards", addRate);
}
