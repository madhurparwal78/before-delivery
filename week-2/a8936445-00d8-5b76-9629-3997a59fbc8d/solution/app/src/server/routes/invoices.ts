// Monthly invoices (brief: Invoices, Shelves).
import { randomUUID } from "node:crypto";
import type { InvoiceLine } from "../../shared/api";
import { KITCHEN_NAME, PRODUCT_NAME } from "../../shared/kitchen";
import { dollars, hhmm, kitchenParts, kitchenStamp } from "../../shared/time";
import { audit, lockFor, one, pool, rows, transaction, type Db } from "../db";
import { invoiceNotice, invoiceReceipt } from "../emails";
import { ApiError, notFound, validation } from "../errors";
import { disposition, route, type Ctx } from "../http";
import * as killbill from "../killbill";
import { queueEmail } from "../mail";
import { renderPdf, type PdfText } from "../pdf";
import { BOOKING_SELECT, invoiceView, loadInvoice, taxBasisPoints, tenantRows, type BookingRow, type InvoiceRow, type TenantRow } from "../records";
import { invoiceTotals, taxRatePercent } from "../rules";
import { getObject } from "../storage";
import { kickSweep } from "../sweep";
import { unitOfWork } from "../unitOfWork";

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

interface Gathered {
  lines: InvoiceLine[];
  stationIds: string[];
  holdoverIds: string[];
  feeIds: string[];
  shelves: { id: string; name: string; monthly_rate_cents: number }[];
}

/** The tenant's items for a kitchen month that are not yet on any invoice, in line order. */
async function gather(db: Db, tenantId: string, period: string): Promise<Gathered> {
  const inPeriod = (column: string) => `to_char(${column}, 'YYYY-MM') = $2`;
  const select = (where: string) => rows<BookingRow>(db, `${BOOKING_SELECT} WHERE b.tenant_id = $1 AND ${where} ORDER BY b.start_at, b.ref FOR UPDATE OF b`, [tenantId, period]);
  const station = await select(`b.pay_with = 'account' AND b.status IN ('completed', 'no_show') AND ${inPeriod("b.date")} AND b.station_invoice_id IS NULL`);
  const holdover = await select(`b.holdover_amount_cents > 0 AND ${inPeriod("b.date")} AND b.holdover_invoice_id IS NULL`);
  const fees = await select(
    `b.pay_with = 'account' AND b.status = 'cancelled' AND b.cancel_late AND b.fee_cents > 0 AND NOT b.fee_refunded AND ${inPeriod("b.cancelled_on")} AND b.fee_invoice_id IS NULL`,
  );
  const shelves = await rows<{ id: string; name: string; monthly_rate_cents: number }>(
    db,
    `SELECT s.id, s.name, s.monthly_rate_cents FROM shelves s
      WHERE s.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM shelf_billings sb WHERE sb.shelf_id = s.id AND sb.tenant_id = $1 AND sb.period = $2)
      ORDER BY s.position`,
    [tenantId, period],
  );
  const lines: InvoiceLine[] = [
    ...station.map((b) => ({
      kind: "station_time" as const,
      description: `Station time ${b.ref}: ${b.station_name}, ${b.date} ${hhmm(b.start_minute)}-${hhmm(b.end_minute)}${b.status === "no_show" ? " (no-show)" : ""}`,
      booking_ref: b.ref,
      amount_cents: b.amount_cents as number,
    })),
    ...holdover.map((b) => ({
      kind: "holdover" as const,
      description: `Hold-over ${b.ref}: ${b.holdover_billed_minutes} min on ${b.station_name}`,
      booking_ref: b.ref,
      amount_cents: b.holdover_amount_cents as number,
    })),
    ...fees.map((b) => ({ kind: "late_fee" as const, description: `Late cancellation fee ${b.ref}`, booking_ref: b.ref, amount_cents: b.fee_cents as number })),
    ...shelves.map((s) => ({ kind: "storage" as const, description: `${s.name}, ${period}`, booking_ref: null, amount_cents: s.monthly_rate_cents })),
  ];
  return { lines, stationIds: station.map((b) => b.id), holdoverIds: holdover.map((b) => b.id), feeIds: fees.map((b) => b.id), shelves };
}

function invoicePdf(tenant: TenantRow, invoice: InvoiceRow): Buffer {
  const texts: PdfText[] = [
    { text: `${PRODUCT_NAME} - ${KITCHEN_NAME}`, x: 56, y: 740, size: 10 },
    { text: `Invoice ${invoice.number}`, x: 56, y: 712, size: 20, bold: true },
    { text: `Billed to: ${tenant.business_name}`, x: 56, y: 686, size: 11 },
    { text: `Period: ${invoice.period}`, x: 56, y: 670, size: 11 },
    { text: `Issued: ${kitchenStamp(invoice.issued_at.getTime())} kitchen time`, x: 56, y: 654, size: 11 },
    { text: "Description", x: 56, y: 620, size: 10, bold: true },
    { text: "Amount", x: 500, y: 620, size: 10, bold: true },
  ];
  let y = 600;
  for (const line of invoice.lines) {
    texts.push({ text: line.description.slice(0, 80), x: 56, y, size: 10 }, { text: dollars(line.amount_cents), x: 500, y, size: 10 });
    y -= 16;
  }
  const totalsAt = y - 12;
  texts.push(
    { text: "Subtotal", x: 380, y: totalsAt, size: 10 },
    { text: dollars(invoice.subtotal_cents), x: 500, y: totalsAt, size: 10 },
    { text: `Sales tax ${taxRatePercent(invoice.tax_rate_basis_points)}%`, x: 380, y: totalsAt - 16, size: 10 },
    { text: dollars(invoice.tax_cents), x: 500, y: totalsAt - 16, size: 10 },
    { text: "Total", x: 380, y: totalsAt - 36, size: 12, bold: true },
    { text: dollars(invoice.total_cents), x: 500, y: totalsAt - 36, size: 12, bold: true },
  );
  return renderPdf(texts, [
    { x1: 56, x2: 556, y: 632 },
    { x1: 56, x2: 556, y: y + 8 },
    { x1: 380, x2: 556, y: totalsAt - 24 },
  ]);
}

const pdfKey = (invoice: InvoiceRow): string => `invoices/${invoice.tenant_id}/${invoice.number}.pdf`;
const loadOwnInvoice = (ctx: Ctx<undefined>): Promise<InvoiceRow> => loadInvoice(pool, ctx.user, ctx.params.id);

export const invoiceRoutes = [
  route({
    method: "POST",
    path: "/api/invoices",
    roles: ["operator"],
    body: "json",
    async handle(ctx) {
      const { tenant_id: tenantId, period } = ctx.json;
      const [tenant] = typeof tenantId === "string" ? await tenantRows(pool, tenantId) : [];
      if (!tenant) throw validation({ tenant_id: "Choose a tenant." });
      if (typeof period !== "string" || !PERIOD.test(period)) throw validation({ period: "Give the month as YYYY-MM." });
      if (period > kitchenParts(ctx.nowMs).date.slice(0, 7)) throw validation({ period: "Invoice the current month or an earlier one." });
      const basisPoints = await taxBasisPoints(pool);
      const invoice = await unitOfWork(async (db, effects) => {
        await lockFor(db, "invoice-tenant", tenant.id);
        await lockFor(db, "invoice-period", period);
        const gathered = await gather(db, tenant.id, period);
        if (gathered.lines.length === 0) throw new ApiError(409, "nothing_to_invoice", `Nothing to invoice for ${period}.`);
        const totals = invoiceTotals(
          gathered.lines.map((l) => l.amount_cents),
          basisPoints,
        );
        const used = (await one<{ n: number }>(db, "SELECT COUNT(*)::integer AS n FROM invoices WHERE period = $1", [period])) as { n: number };
        const number = `INV-${period.replace("-", "")}-${String(used.n + 1).padStart(4, "0")}`;
        const issued = (await one<InvoiceRow>(
          db,
          `INSERT INTO invoices (id, number, tenant_id, period, status, lines, subtotal_cents, tax_rate_basis_points, tax_cents, total_cents, issued_at)
           VALUES ($1, $2, $3, $4, 'issued', $5, $6, $7, $8, $9, $10) RETURNING *`,
          [randomUUID(), number, tenant.id, period, JSON.stringify(gathered.lines), totals.subtotal, basisPoints, totals.tax, totals.total, new Date(ctx.nowMs)],
        )) as InvoiceRow;
        await db.query("UPDATE bookings SET station_invoice_id = $1 WHERE id = ANY($2::uuid[])", [issued.id, gathered.stationIds]);
        await db.query("UPDATE bookings SET holdover_invoice_id = $1 WHERE id = ANY($2::uuid[])", [issued.id, gathered.holdoverIds]);
        await db.query("UPDATE bookings SET fee_invoice_id = $1 WHERE id = ANY($2::uuid[])", [issued.id, gathered.feeIds]);
        for (const shelf of gathered.shelves) {
          await db.query("INSERT INTO shelf_billings (shelf_id, tenant_id, period, invoice_id) VALUES ($1, $2, $3, $4)", [shelf.id, tenant.id, period, issued.id]);
        }
        await queueEmail(db, invoiceNotice(tenant, issued));
        await audit(db, ctx.user.id, "invoice", number, "issued", { total_cents: totals.total });
        const account = { tenantId: tenant.id, accountId: await killbill.accountFor(tenant) };
        for (const shelf of gathered.shelves) await effects.bill(account, "charge", shelf.monthly_rate_cents, `Storage shelf ${shelf.id} ${period}`);
        if (totals.tax > 0) await effects.bill(account, "charge", totals.tax, `Sales tax ${number}`);
        await effects.store(pdfKey(issued), invoicePdf(tenant, issued), "application/pdf");
        return issued;
      });
      kickSweep();
      return { status: 201, json: invoiceView(invoice) };
    },
  }),
  route({
    method: "GET",
    path: "/api/invoices",
    roles: ["operator", "owner"],
    async handle(ctx) {
      const tenantId = ctx.user.role === "operator" ? ctx.query.get("tenant_id") || null : ctx.user.tenant_id;
      const found = await rows<InvoiceRow>(pool, "SELECT * FROM invoices WHERE ($1::text IS NULL OR tenant_id = $1) ORDER BY issued_at DESC, number DESC", [tenantId]);
      return { status: 200, json: { invoices: found.map(invoiceView) } };
    },
  }),
  route<InvoiceRow>({
    method: "GET",
    path: "/api/invoices/:id",
    roles: ["operator", "owner"],
    load: loadOwnInvoice,
    async handle(ctx) {
      return { status: 200, json: invoiceView(ctx.loaded) };
    },
  }),
  route<InvoiceRow>({
    method: "GET",
    path: "/api/invoices/:id/pdf",
    roles: ["operator", "owner"],
    load: loadOwnInvoice,
    async handle(ctx) {
      const pdf = await getObject(pdfKey(ctx.loaded));
      if (!pdf) throw notFound();
      return { status: 200, file: { body: pdf, contentType: "application/pdf", disposition: disposition("attachment", `${ctx.loaded.number}.pdf`) } };
    },
  }),
  route<InvoiceRow>({
    method: "POST",
    path: "/api/invoices/:id/pay",
    roles: ["owner"],
    body: "json",
    idempotent: true,
    load: loadOwnInvoice,
    async handle(ctx) {
      const paid = await transaction(async (db) => {
        const invoice = await loadInvoice(db, ctx.user, ctx.loaded.id, true);
        if (invoice.status === "paid") throw new ApiError(409, "invoice_paid", "This invoice is already paid.");
        const [tenant] = await tenantRows(db, invoice.tenant_id);
        await killbill.purchase(await killbill.accountFor(tenant), invoice.total_cents, `invoice-${invoice.number}`);
        const updated = (await one<InvoiceRow>(db, "UPDATE invoices SET status = 'paid', paid_at = $2 WHERE id = $1 RETURNING *", [invoice.id, new Date(ctx.nowMs)])) as InvoiceRow;
        await queueEmail(db, invoiceReceipt(tenant, invoice.number, invoice.total_cents));
        await audit(db, ctx.user.id, "invoice", invoice.number, "paid");
        return updated;
      });
      kickSweep();
      return { status: 200, json: invoiceView(paid) };
    },
  }),
];
