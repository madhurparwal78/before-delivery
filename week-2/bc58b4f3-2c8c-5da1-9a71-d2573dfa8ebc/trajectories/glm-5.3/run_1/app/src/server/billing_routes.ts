import { Pool } from "pg";
import { ApiError, validationError } from "./errors";
import { sendJson } from "./httpio";
import { Ctx, Router, readJson } from "./router";
import { Config, withTx } from "./config";
import { loadAssignment, loadSeats, loadBilling } from "./assignments";
import {
  serviceLine, rateInForce, seatAmountCents, billableMinutes, billableMiles,
  mileageCents as mileageCentsCalc, MIN_BILLABLE_MINUTES,
} from "./rules";
import { centralDateISO } from "../shared/time";
import { KillBillUnavailable, postCharge } from "./killbill";

interface Deps {
  db: Pool;
  config: Config;
}

interface ChargeLine {
  seat: number;
  actual_minutes: number | null;
  billable_minutes: number;
  amount_cents: number;
  round_trip_miles: number | null;
  billable_miles: number;
  mileage_cents: number;
}

interface ChargeComputation {
  assignmentId: number;
  orgCode: string;
  orgName: string;
  number: string;
  kind: "service" | "late_cancellation";
  rate: { effective_from: string; hourly_rate_cents: number; mileage_cents_per_mile: number };
  lines: ChargeLine[];
  total_cents: number;
  description: string;
}

type QuerySink = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export async function chargesForAssignment(tx: QuerySink, number: string): Promise<ChargeComputation> {
  const a = await loadAssignment(tx as never, number);
  if (!a) throw new ApiError("not_found", "No such request.");
  const orgRes = await tx.query(`SELECT name FROM organisations WHERE code = $1`, [a.org_code]);
  const orgName = (orgRes.rows[0] as { name: string }).name;
  const seats = await loadSeats(tx as never, a.id);
  const rate = await rateInForce(tx as never, a.org_code, serviceLine(a.language_code), centralDateISO(a.start_at));
  const kind: "service" | "late_cancellation" = a.status === "cancelled" ? "late_cancellation" : "service";
  const lines: ChargeLine[] = seats.map((s) => {
    const mins = kind === "service" ? billableMinutes(s.actual_minutes ?? 0) : MIN_BILLABLE_MINUTES;
    const amount = seatAmountCents(rate.hourly_rate_cents, mins);
    const miles = kind === "service" ? billableMiles(s.round_trip_miles ?? 0) : 0;
    return {
      seat: s.seat,
      actual_minutes: kind === "service" ? (s.actual_minutes ?? null) : null,
      billable_minutes: mins,
      amount_cents: amount,
      round_trip_miles: kind === "service" ? (s.round_trip_miles ?? null) : 0,
      billable_miles: miles,
      mileage_cents: mileageCentsCalc(miles, rate.mileage_cents_per_mile),
    };
  });
  const total = lines.reduce((sum, l) => sum + l.amount_cents + l.mileage_cents, 0);
  return {
    assignmentId: a.id,
    orgCode: a.org_code,
    orgName,
    number: a.number,
    kind,
    rate: {
      effective_from: rate.effective_from,
      hourly_rate_cents: rate.hourly_rate_cents,
      mileage_cents_per_mile: rate.mileage_cents_per_mile,
    },
    lines,
    total_cents: total,
    description: `${a.number} ${kind === "service" ? "service" : "late cancellation"}`,
  };
}

async function handleCharges(ctx: Ctx, deps: Deps): Promise<void> {
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    if (!(await isBillable(tx, a.id, a.status))) throw new ApiError("not_billable", "This item is not ready to invoice.");
    const computation = await chargesForAssignment(tx, a.number);
    sendJson(ctx.res, 200, {
      number: computation.number,
      kind: computation.kind,
      rate: computation.rate,
      lines: computation.lines,
      total_cents: computation.total_cents,
    });
  });
}

/** Billable: a verified assignment, or a cancelled one whose fee decision carries a fee. */
async function isBillable(tx: QuerySink, assignmentId: number, status: string): Promise<boolean> {
  if (status === "verified") return true;
  if (status !== "cancelled") return false;
  const res = await tx.query(`SELECT fee_applies FROM cancellations WHERE assignment_id = $1`, [assignmentId]);
  return res.rows.length > 0 && (res.rows[0] as { fee_applies: boolean }).fee_applies;
}

/** Post one billable assignment to Kill Bill; exactly-once across requests, retries and outages. */
async function postAssignment(deps: Deps, number: string): Promise<{ status: "posted" | "queued" | "ready"; invoice_id: string | null; total_cents: number | null }> {
  const ready = await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, number);
    const billing = await loadBilling(tx, a.id);
    // A repeat post returns the stored invoice whatever the assignment status.
    if (billing.status === "posted") return { state: "posted" as const, invoice_id: billing.invoice_id, total_cents: billing.total_cents };
    if (!(await isBillable(tx, a.id, a.status))) throw new ApiError("not_billable", "This item is not ready to invoice.");
    const computation = await chargesForAssignment(tx, number);
    if (billing.status !== "queued") {
      await tx.query(
        `INSERT INTO billing (assignment_id, status, total_cents) VALUES ($1,'ready',$2)
         ON CONFLICT (assignment_id) DO UPDATE SET status='ready', total_cents=$2`,
        [computation.assignmentId, computation.total_cents],
      );
    } else {
      await tx.query(`UPDATE billing SET total_cents=$2 WHERE assignment_id=$1`, [computation.assignmentId, computation.total_cents]);
    }
    return { state: "computed" as const, computation };
  });

  if (ready.state === "posted") {
    return { status: "posted", invoice_id: ready.invoice_id, total_cents: ready.total_cents };
  }

  const { computation } = ready;
  try {
    const result = await postCharge(deps.config, computation.orgCode, computation.orgName, computation.total_cents, computation.description);
    await withTx(deps.db, async (tx) => {
      await tx.query(
        `UPDATE billing SET status='posted', invoice_id=$2, total_cents=$3 WHERE assignment_id=$1`,
        [computation.assignmentId, result.invoiceId, computation.total_cents],
      );
      await tx.query(`INSERT INTO audit_log (kind, detail) VALUES ('post', $1)`, [
        JSON.stringify({ number: computation.number, invoice_id: result.invoiceId, total_cents: computation.total_cents }),
      ]);
      const a = await loadAssignment(tx, number);
      if (a.status === "verified") {
        await tx.query(`UPDATE assignments SET status='invoiced' WHERE id=$1`, [a.id]);
      }
    });
    return { status: "posted", invoice_id: result.invoiceId, total_cents: computation.total_cents };
  } catch (e) {
    if (!(e instanceof KillBillUnavailable)) throw e;
    await withTx(deps.db, async (tx) => {
      await tx.query(
        `INSERT INTO billing (assignment_id, status, total_cents, queued_at) VALUES ($1,'queued',$2,now())
         ON CONFLICT (assignment_id) DO UPDATE SET status='queued', total_cents=$2, queued_at=now()`,
        [computation.assignmentId, computation.total_cents],
      );
    });
    return { status: "queued", invoice_id: null, total_cents: computation.total_cents };
  }
}

async function handleInvoice(ctx: Ctx, deps: Deps): Promise<void> {
  const result = await postAssignment(deps, ctx.params.number);
  const billing = { status: result.status, invoice_id: result.invoice_id, total_cents: result.total_cents };
  if (result.status === "posted") {
    sendJson(ctx.res, 201, { billing });
  } else {
    sendJson(ctx.res, 202, { billing });
  }
}

async function handleQueue(ctx: Ctx, deps: Deps): Promise<void> {
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT a.number FROM assignments a JOIN billing b ON b.assignment_id = a.id
        WHERE b.status IN ('ready','queued','posted')
        ORDER BY a.start_at ASC, a.id ASC`,
    );
    const items: Record<string, unknown>[] = [];
    for (const row of res.rows as { number: string }[]) {
      const a = await loadAssignment(tx, row.number);
      const billing = await loadBilling(tx, a.id);
      items.push({
        number: a.number,
        org_code: a.org_code,
        kind: a.status === "cancelled" ? "late_cancellation" : "service",
        start_at: a.start_at.toISOString(),
        total_cents: billing.total_cents,
        billing,
      });
    }
    sendJson(ctx.res, 200, { items });
  });
}

async function handleRateCardsList(ctx: Ctx, deps: Deps): Promise<void> {
  const org = ctx.query.get("org") ?? "";
  await withTx(deps.db, async (tx) => {
    const orgRes = await tx.query(`SELECT code FROM organisations WHERE code = $1`, [org]);
    if (orgRes.rows.length === 0) throw new ApiError("not_found", "No such organisation.");
    const res = await tx.query(
      `SELECT org_code, service_line, effective_from::text AS effective_from, hourly_rate_cents, mileage_cents_per_mile
         FROM rate_cards WHERE org_code = $1 ORDER BY effective_from ASC`,
      [org],
    );
    sendJson(ctx.res, 200, {
      entries: res.rows.map((r) => ({
        org: r.org_code,
        service_line: r.service_line,
        effective_from: r.effective_from,
        hourly_rate_cents: r.hourly_rate_cents,
        mileage_cents_per_mile: r.mileage_cents_per_mile,
      })),
    });
  });
}

function centralToday(): string {
  return centralDateISO(new Date());
}

async function handleRateCardsCreate(ctx: Ctx, deps: Deps): Promise<void> {
  const body = readJson(ctx);
  const fields: Record<string, string> = {};
  const org = typeof body.org === "string" ? body.org : "";
  const serviceLineValue = typeof body.service_line === "string" ? body.service_line : "";
  const effectiveFrom = typeof body.effective_from === "string" ? body.effective_from : "";
  const rate = body.hourly_rate_cents;
  const mileage = body.mileage_cents_per_mile;

  if (serviceLineValue !== "asl" && serviceLineValue !== "spoken") {
    fields.service_line = "Pick asl or spoken.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
    fields.effective_from = "Enter a date as YYYY-MM-DD.";
  } else if (effectiveFrom <= centralToday()) {
    fields.effective_from = "The effective date must be later than today.";
  }
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 1 || rate > 1_000_000) {
    fields.hourly_rate_cents = "Enter whole cents from 1 to 1,000,000.";
  }
  if (typeof mileage !== "number" || !Number.isInteger(mileage) || mileage < 0 || mileage > 1000) {
    fields.mileage_cents_per_mile = "Enter whole cents from 0 to 1,000.";
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);

  await withTx(deps.db, async (tx) => {
    const orgRes = await tx.query(`SELECT code FROM organisations WHERE code = $1`, [org]);
    if (orgRes.rows.length === 0) throw new ApiError("not_found", "No such organisation.");
    try {
      const res = await tx.query(
        `INSERT INTO rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
         VALUES ($1,$2,$3,$4,$5) RETURNING org_code, service_line, effective_from::text AS effective_from, hourly_rate_cents, mileage_cents_per_mile`,
        [org, serviceLineValue, effectiveFrom, rate, mileage],
      );
      const row = res.rows[0];
      await tx.query(`INSERT INTO audit_log (kind, detail) VALUES ('rate_entry', $1)`, [
        JSON.stringify({ org, service_line: serviceLineValue, effective_from: effectiveFrom }),
      ]);
      sendJson(ctx.res, 201, {
        org: row.org_code,
        service_line: row.service_line,
        effective_from: row.effective_from,
        hourly_rate_cents: row.hourly_rate_cents,
        mileage_cents_per_mile: row.mileage_cents_per_mile,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ApiError("duplicate_rate", "A rate already starts on that date.");
      }
      throw e;
    }
  });
}

export function registerBillingRoutes(router: Router, deps: Deps): void {
  router.add("GET", "/api/assignments/:number/charges", {
    roles: ["billing_lead"],
    handler: (ctx) => handleCharges(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/invoice", {
    body: "json", roles: ["billing_lead"],
    handler: (ctx) => handleInvoice(ctx, deps),
  });
  router.add("GET", "/api/billing/queue", {
    roles: ["billing_lead"],
    handler: (ctx) => handleQueue(ctx, deps),
  });
  router.add("GET", "/api/rate-cards", {
    roles: ["billing_lead"],
    handler: (ctx) => handleRateCardsList(ctx, deps),
  });
  router.add("POST", "/api/rate-cards", {
    body: "json", roles: ["billing_lead"],
    handler: (ctx) => handleRateCardsCreate(ctx, deps),
  });
}

/** Background retry: post every queued item; called on the billing loop. */
export async function retryQueuedPosts(deps: Deps): Promise<void> {
  const res = await deps.db.query(
    `SELECT a.number FROM assignments a JOIN billing b ON b.assignment_id = a.id
      WHERE b.status = 'queued' ORDER BY a.id`,
  );
  for (const row of res.rows as { number: string }[]) {
    await postAssignment(deps, row.number);
  }
}
