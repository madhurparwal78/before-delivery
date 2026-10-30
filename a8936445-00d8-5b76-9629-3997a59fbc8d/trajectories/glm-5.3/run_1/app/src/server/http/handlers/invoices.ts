/** Invoices: month gathering with exact tax, the PDF in storage, Kill Bill charges, notice and payment. */

import type { InvoiceLine } from "../../../shared/api-types.js";
import { centsToDollars, taxOfSubtotal } from "../../../shared/money.js";
import { uuid } from "../../db.js";
import { buildPdf } from "../../pdf.js";
import type { Storage } from "../../providers/storage.js";
import type { KillBillClient } from "../../providers/killbill.js";
import { invoiceNoticeEmail, invoiceReceiptEmail, queueEmail } from "../../email.js";
import { UnitOfWorkRunner } from "../../domain/unit-of-work.js";
import { err, notFound, validation } from "../errors.js";
import type { App, RouteContext } from "../server.js";
import { json, readJson, requireIdempotencyKey, requireRole, requireUser, str } from "./helpers.js";

interface InvoiceRow {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: "issued" | "paid";
  subtotal_cents: number;
  tax_rate_percent: string;
  tax_cents: number;
  total_cents: number;
  pdf_key: string | null;
  issued_at: Date;
  paid_at: Date | null;
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  kind: "station_time" | "holdover" | "late_fee" | "storage";
  description: string;
  booking_id: string | null;
  shelf_id: string | null;
  booking_ref: string | null;
  amount_cents: number;
}
export function invoiceJson(row: InvoiceRow, lines: InvoiceLineRow[]): import("../../../shared/api-types.js").Invoice {
  const lineJson: InvoiceLine[] = lines.map((l) => ({
    kind: l.kind,
    description: l.description,
    booking_ref: l.booking_ref,
    amount_cents: l.amount_cents
  }));
  return {
    id: row.id,
    number: row.number,
    tenant_id: row.tenant_id,
    period: row.period,
    status: row.status,
    lines: lineJson,
    subtotal_cents: row.subtotal_cents,
    tax_rate_percent: row.tax_rate_percent,
    tax_cents: row.tax_cents,
    total_cents: row.total_cents,
    issued_at: row.issued_at.toISOString(),
    paid_at: row.paid_at ? row.paid_at.toISOString() : null
  };
}

export function registerInvoiceRoutes(
  app: App,
  uow: UnitOfWorkRunner,
  killbill: KillBillClient,
  storage: Storage
): void {
  app.route("POST", "/api/invoices", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const body = await readJson(rc.ctx);
    const tenantId = str(body["tenant_id"]) ?? "";
    const period = str(body["period"]) ?? "";
    if (tenantId === "") {
      throw validation({ tenant_id: "Choose the tenant to invoice." });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw validation({ period: "Give the month as YYYY-MM." });
    }
    if (period > rc.db.clock.monthOf(rc.db.clock.today())) {
      throw validation({ period: "The month may not be later than the current kitchen month." });
    }
    const tenantRows = await rc.db.query<{ business_name: string; owner_email: string }>(
      "SELECT business_name, owner_email FROM tenants WHERE id = $1",
      [tenantId]
    );
    if (tenantRows.length === 0) {
      throw notFound();
    }
    const tenant = tenantRows[0];

    // Gather the tenant's uninvoiced items for the month, in order.
    const items = await gatherInvoiceItems(rc, tenantId, period);
    if (items.length === 0) {
      throw err(409, "nothing_to_invoice", "There is nothing to invoice for that month.");
    }
    const subtotal = items.reduce((sum, i) => sum + i.amount_cents, 0);
    const tax = taxOfSubtotal(subtotal, rc.db.taxRatePercent);
    const total = subtotal + tax;

    // The invoice number sequence is per period across the kitchen.
    const numberRow = await rc.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM invoices WHERE period = $1",
      [period]
    );
    const number = `INV-${period.replaceAll("-", "")}-${String(Number(numberRow[0].count) + 1).padStart(4, "0")}`;
    const invoiceId = uuid();

    const pdfKey = `invoices/${tenantId}/${number}.pdf`;
    const buildPdfBytes = () =>
      buildPdf(`Invoice ${number}`, [
        { text: `${tenant.business_name} — ${period}`, size: 12 },
        ...items.map((i) => ({ text: `${i.description} — ${centsToDollars(i.amount_cents)}`, size: 11 })),
        { text: `Subtotal ${centsToDollars(subtotal)}`, size: 11 },
        { text: `Sales tax (${rc.db.taxRatePercent}%) ${centsToDollars(tax)}`, size: 11 },
        { text: `Total ${centsToDollars(total)}`, size: 13, bold: true }
      ]);

    const billedShelves = items.filter((i) => i.shelf_id !== null);
    await uow.run({
      write: async (client) => {
        await client.query(
          `INSERT INTO invoices (id, number, tenant_id, period, status, subtotal_cents, tax_rate_percent,
                 tax_cents, total_cents, pdf_key, issued_at)
           VALUES ($1,$2,$3,$4,'issued',$5,$6,$7,$8,$9, now())`,
          [invoiceId, number, tenantId, period, subtotal, rc.db.taxRatePercent, tax, total, pdfKey]
        );
        for (const [index, item] of items.entries()) {
          await client.query(
            `INSERT INTO invoice_lines (id, invoice_id, position, kind, description, booking_id, shelf_id, booking_ref, amount_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              uuid(),
              invoiceId,
              index,
              item.kind,
              item.description,
              item.booking_id ?? null,
              item.shelf_id ?? null,
              item.booking_ref ?? null,
              item.amount_cents
            ]
          );
        }
        await queueEmail(
          client,
          invoiceNoticeEmail(
            tenant.owner_email,
            number,
            period,
            items.map((i) => ({ description: i.description, amount: centsToDollars(i.amount_cents) })),
            centsToDollars(subtotal),
            centsToDollars(tax),
            centsToDollars(total)
          )
        );
      },
      killBill: [
        ...billedShelves.map((shelf) => ({
          tenantId,
          businessName: tenant.business_name,
          kind: "charge" as const,
          charge: {
            kind: "charge" as const,
            description: `Storage shelf ${shelf.shelf_id} ${period}`,
            amountCents: shelf.amount_cents
          }
        })),
        ...(tax > 0
          ? [
              {
                tenantId,
                businessName: tenant.business_name,
                kind: "charge" as const,
                charge: {
                  kind: "charge" as const,
                  description: `Sales tax ${number}`,
                  amountCents: tax
                }
              }
            ]
          : [])
      ],
      store: { key: pdfKey, body: buildPdfBytes, contentType: "application/pdf" }
    });
    await rc.db.audit(user.id, "issue_invoice", "invoice", invoiceId, { tenant_id: tenantId, period });
    return json(201, invoiceJson(await loadInvoice(rc, invoiceId), await loadLines(rc, invoiceId)));
  });

  app.route("GET", "/api/invoices", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    let tenantId: string | null = null;
    const filter = rc.ctx.url.searchParams.get("tenant_id");
    if (user.role === "operator") {
      if (filter !== null) tenantId = filter;
    } else {
      tenantId = user.tenant_id;
    }
    const params: unknown[] = [];
    let where = "TRUE";
    if (tenantId !== null) {
      params.push(tenantId);
      where = `tenant_id = $${params.length}`;
      if (user.tenant_id !== null && tenantId !== user.tenant_id) {
        throw notFound();
      }
    }
    const rows = await rc.db.query<InvoiceRow>(
      `SELECT id, number, tenant_id, period, status, subtotal_cents, tax_rate_percent, tax_cents,
              total_cents, pdf_key, issued_at, paid_at
       FROM invoices WHERE ${where} ORDER BY issued_at DESC, number DESC`,
      params
    );
    const out = [];
    for (const row of rows) {
      out.push(invoiceJson(row, await loadLines(rc, row.id)));
    }
    return json(200, { invoices: out });
  });

  app.route("GET", "/api/invoices/:id", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const invoice = await loadOwnInvoice(rc, user, rc.ctx.params["id"] ?? "");
    return json(200, invoiceJson(invoice, await loadLines(rc, invoice.id)));
  });

  app.route("GET", "/api/invoices/:id/pdf", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const invoice = await loadOwnInvoice(rc, user, rc.ctx.params["id"] ?? "");
    if (invoice.pdf_key === null) {
      throw notFound();
    }
    const bytes = await storage.getObject(invoice.pdf_key);
    return {
      status: 200,
      body: bytes,
      contentType: "application/pdf",
      disposition: `attachment; filename="${invoice.number}.pdf"`
    };
  });

  app.route("POST", "/api/invoices/:id/pay", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["owner"]);
    requireIdempotencyKey(rc.ctx);
    const invoice = await loadOwnInvoice(rc, user, rc.ctx.params["id"] ?? "");
    if (invoice.status === "paid") {
      throw err(409, "invoice_paid", "This invoice is already paid.");
    }
    const tenantRows = await rc.db.query<{ business_name: string; owner_email: string }>(
      "SELECT business_name, owner_email FROM tenants WHERE id = $1",
      [invoice.tenant_id]
    );
    const tenant = tenantRows[0];
    await uow.run({
      write: async (client) => {
        await client.query(
          "UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'issued'",
          [invoice.id]
        );
        await queueEmail(client, invoiceReceiptEmail(tenant.owner_email, invoice.number, centsToDollars(invoice.total_cents)));
      },
      payments: [
        {
          tenantId: invoice.tenant_id,
          businessName: tenant.business_name,
          amountCents: invoice.total_cents,
          transactionExternalKey: `invoice-${invoice.number}`
        }
      ]
    });
    await rc.db.audit(user.id, "pay_invoice", "invoice", invoice.id, {});
    return json(200, invoiceJson(await loadInvoice(rc, invoice.id), await loadLines(rc, invoice.id)));
  });
}

interface InvoiceItem {
  kind: "station_time" | "holdover" | "late_fee" | "storage";
  description: string;
  booking_id: string | null;
  shelf_id: string | null;
  booking_ref: string | null;
  amount_cents: number;
}

/** The tenant's uninvoiced items for a kitchen month, in the published order. */
async function gatherInvoiceItems(rc: RouteContext, tenantId: string, period: string): Promise<InvoiceItem[]> {
  const items: InvoiceItem[] = [];

  const stationTime = await rc.db.query<{
    id: string;
    ref: string;
    station_name: string;
    date: string;
    amount_cents: number | null;
  }>(
    `SELECT b.id, b.ref, s.name AS station_name, b.date::text AS date, b.amount_cents
     FROM bookings b JOIN stations s ON s.id = b.station_id
     WHERE b.tenant_id = $1 AND b.date::text LIKE $2 || '%'
       AND b.status IN ('completed','no_show') AND b.pay_with = 'account'
       AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.booking_id = b.id AND il.kind = 'station_time')
     ORDER BY b.start`,
    [tenantId, period]
  );
  for (const row of stationTime) {
    items.push({
      kind: "station_time",
      description: `Station time ${row.ref} — ${row.station_name}, ${row.date}`,
      booking_id: row.id,
      shelf_id: null,
      booking_ref: row.ref,
      amount_cents: row.amount_cents ?? 0
    });
  }

  const holdovers = await rc.db.query<{ id: string; ref: string; holdover_cents: number | null }>(
    `SELECT b.id, b.ref, b.holdover_cents
     FROM bookings b
     WHERE b.tenant_id = $1 AND b.date::text LIKE $2 || '%'
       AND b.holdover_cents IS NOT NULL AND b.holdover_cents > 0
       AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.booking_id = b.id AND il.kind = 'holdover')
     ORDER BY b.start`,
    [tenantId, period]
  );
  for (const row of holdovers) {
    items.push({
      kind: "holdover",
      description: `Hold-over ${row.ref}`,
      booking_id: row.id,
      shelf_id: null,
      booking_ref: row.ref,
      amount_cents: row.holdover_cents ?? 0
    });
  }

  const lateFees = await rc.db.query<{ id: string; ref: string; fee_cents: number }>(
    `SELECT b.id, b.ref, b.fee_cents
     FROM bookings b
     WHERE b.tenant_id = $1 AND b.status = 'cancelled' AND b.cancelled_at::text LIKE $2 || '%'
       AND b.pay_with = 'account' AND b.cancelled_late AND NOT b.fee_refunded AND b.fee_cents > 0
       AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.booking_id = b.id AND il.kind = 'late_fee')
     ORDER BY b.cancelled_at`,
    [tenantId, period]
  );
  for (const row of lateFees) {
    items.push({
      kind: "late_fee",
      description: `Late cancellation fee ${row.ref}`,
      booking_id: row.id,
      shelf_id: null,
      booking_ref: row.ref,
      amount_cents: row.fee_cents
    });
  }

  const shelves = await rc.db.query<{ id: string; name: string; monthly_rate_cents: number }>(
    `SELECT sh.id, sh.name, sh.monthly_rate_cents
     FROM shelves sh
     WHERE sh.tenant_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM invoice_lines il
         WHERE il.shelf_id = sh.id AND il.invoice_id IN (SELECT id FROM invoices WHERE period = $2)
       )
     ORDER BY sh.id`,
    [tenantId, period]
  );
  for (const shelf of shelves) {
    items.push({
      kind: "storage",
      description: `${shelf.name} — ${period}`,
      booking_id: null,
      shelf_id: shelf.id,
      booking_ref: null,
      amount_cents: shelf.monthly_rate_cents
    });
  }
  return items;
}

async function loadInvoice(rc: RouteContext, id: string): Promise<InvoiceRow> {
  const rows = await rc.db.query<InvoiceRow>(
    `SELECT id, number, tenant_id, period, status, subtotal_cents, tax_rate_percent::text AS tax_rate_percent,
            tax_cents, total_cents, pdf_key, issued_at, paid_at
     FROM invoices WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) {
    throw notFound();
  }
  return rows[0];
}

async function loadLines(rc: RouteContext, invoiceId: string): Promise<InvoiceLineRow[]> {
  return rc.db.query<InvoiceLineRow>(
    "SELECT id, invoice_id, kind, description, booking_id, shelf_id, booking_ref, amount_cents FROM invoice_lines WHERE invoice_id = $1 ORDER BY position",
    [invoiceId]
  );
}

async function loadOwnInvoice(rc: RouteContext, user: { role: string; tenant_id: string | null }, id: string): Promise<InvoiceRow> {
  const invoice = await loadInvoice(rc, id);
  if (user.tenant_id !== null && invoice.tenant_id !== user.tenant_id) {
    throw notFound();
  }
  return invoice;
}
