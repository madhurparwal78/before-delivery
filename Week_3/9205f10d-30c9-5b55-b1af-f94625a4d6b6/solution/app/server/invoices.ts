import { toAgencyIso } from "../shared/agencyTime.js";
import { type Db, many, pool } from "./db.js";
import { type Context, type Router, ok } from "./http.js";
import { dollars } from "./rules.js";

interface ChargeRow {
  id: string;
  reference: string;
  organisation_id: string;
  organisation_name: string;
  organisation_code: string;
  kind: "interpreting" | "late_cancellation";
  billable_minutes: number;
  seats: number;
  hourly_rate_cents: number;
  amount_cents: number;
  killbill_invoice_id: string | null;
  created_at: Date;
}

interface Invoice {
  id: string;
  request_reference: string;
  organisation: { id: string; name: string; code: string };
  kind: ChargeRow["kind"];
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: "pending" | "posted";
  killbill_invoice_id: string | null;
  created_at: string;
}

/** Charges as invoices, newest first. */
export async function loadInvoices(db: Db, where: string, params: unknown[]): Promise<Invoice[]> {
  const rows = await many<ChargeRow>(
    db,
    `SELECT ch.id, r.reference, o.id AS organisation_id, o.name AS organisation_name, o.code AS organisation_code,
            ch.kind, ch.billable_minutes, ch.seats, ch.hourly_rate_cents, ch.amount_cents, ch.killbill_invoice_id,
            ch.created_at
     FROM charges ch JOIN requests r ON r.id = ch.request_id JOIN organisations o ON o.id = r.organisation_id
     WHERE ${where}
     ORDER BY ch.created_at DESC, ch.position DESC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    request_reference: row.reference,
    organisation: { id: row.organisation_id, name: row.organisation_name, code: row.organisation_code },
    kind: row.kind,
    billable_minutes: row.billable_minutes,
    seats: row.seats,
    hourly_rate: dollars(row.hourly_rate_cents),
    amount: dollars(row.amount_cents),
    billing_status: row.killbill_invoice_id ? "posted" : "pending",
    killbill_invoice_id: row.killbill_invoice_id,
    created_at: toAgencyIso(row.created_at),
  }));
}

/** The invoices the caller may see, filtered by the search rule on the request reference. */
async function visibleInvoices(ctx: Context): Promise<Invoice[]> {
  ctx.allow("billing_admin", "client_scheduler");
  const clauses = ["true"];
  const params: unknown[] = [];
  if (ctx.user.role === "client_scheduler") {
    params.push(ctx.user.organisation?.id);
    clauses.push(`r.organisation_id = $${params.length}`);
  }
  const q = ctx.url.searchParams.get("q");
  if (q) {
    params.push(q);
    clauses.push(`position(lower($${params.length}) in lower(r.reference)) > 0`);
  }
  return loadInvoices(pool, clauses.join(" AND "), params);
}

const CSV_HEADER = [
  "reference",
  "organisation",
  "kind",
  "billable_minutes",
  "seats",
  "hourly_rate",
  "amount",
  "billing_status",
  "killbill_invoice_id",
  "created_at",
];

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(invoices: Invoice[]): string {
  const rows = invoices.map((i) => [
    i.request_reference,
    i.organisation.name,
    i.kind,
    i.billable_minutes,
    i.seats,
    i.hourly_rate,
    i.amount,
    i.billing_status,
    i.killbill_invoice_id,
    i.created_at,
  ]);
  return [CSV_HEADER, ...rows].map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}

export function registerInvoices(router: Router): void {
  router.on("GET", "/api/invoices", async (ctx) => ok({ invoices: await visibleInvoices(ctx) }));
  router.on("GET", "/api/invoices.csv", async (ctx) => ({
    status: 200,
    text: csv(await visibleInvoices(ctx)),
    contentType: "text/csv; charset=utf-8",
    headers: { "Content-Disposition": 'attachment; filename="crosshand-invoices.csv"', "Cache-Control": "no-store" },
  }));
}
