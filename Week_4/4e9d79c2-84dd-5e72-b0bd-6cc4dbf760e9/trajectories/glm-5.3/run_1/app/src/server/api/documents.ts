import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { renderPdf } from "../services.js";
import { s3Put, s3Get, objectKeyForDocument } from "../s3.js";
import { tx, vehiclesFor, isoDate } from "../repo.js";
import { isoInstant, ukTimeHM } from "../domain.js";
import { penniesToString } from "../money.js";
import { seatGridFor } from "../hours.js";
import { ukDateString } from "../uktime.js";
import { fileRateLimited } from "./documents-helpers.js";

const KIND_LABEL: Record<string, string> = {
  quote: "Quote",
  confirmationLetter: "Confirmation letter",
  invoice: "Invoice",
  creditNote: "Credit note",
  seatPlan: "Seat plan",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function registerDocumentApi(app: Express, ctx: Ctx): void {
  app.get("/api/documents", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const docs = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 ORDER BY created_at DESC", [deskId]);
    const year = Number(ukDateString(new Date()).slice(0, 4));
    const invoice = await ctx.db.query("SELECT COALESCE(MAX(last_number),0) AS last FROM document_numbers WHERE desk_id=$1 AND kind_prefix='INV' AND year=$2", [deskId, year]);
    const credit = await ctx.db.query("SELECT COALESCE(MAX(last_number),0) AS last FROM document_numbers WHERE desk_id=$1 AND kind_prefix='CN' AND year=$2", [deskId, year]);
    const issuedInvoices = await ctx.db.query("SELECT number FROM documents WHERE desk_id=$1 AND kind='invoice' AND number IS NOT NULL", [deskId]);
    const issuedCredits = await ctx.db.query("SELECT number FROM documents WHERE desk_id=$1 AND kind='creditNote' AND number IS NOT NULL", [deskId]);
    const maxIssued = (rows: { number: string }[], prefix: string): number => {
      let max = 0;
      for (const r of rows) {
        const m = new RegExp(`^${prefix}-\\d{4}-(\\d{4})$`).exec(String(r.number));
        if (m) max = Math.max(max, Number(m[1]));
      }
      return max;
    };
    const nextInvoice = `INV-${year}-${String(Math.max(maxIssued(issuedInvoices.rows, "INV"), Number(invoice.rows[0].last)) + 1).padStart(4, "0")}`;
    const nextCredit = `CN-${year}-${String(Math.max(maxIssued(issuedCredits.rows, "CN"), Number(credit.rows[0].last)) + 1).padStart(4, "0")}`;
    res.json({ documents: docs.rows.map(documentOut), nextInvoice, nextCreditNote: nextCredit });
  });

  app.post("/api/hires/:id/documents", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!["quote", "confirmationLetter", "invoice", "creditNote", "seatPlan"].includes(kind)) {
      throw errors.invalid({ kind: "We can't find that." });
    }
    if ((kind === "invoice" || kind === "confirmationLetter" || kind === "creditNote") && hire.rows[0].stage === "quoted") {
      throw errors.state("noAcceptedQuote", "This hire has no accepted quote yet.");
    }
    const id = "DC-" + Math.random().toString(36).slice(2, 12).toUpperCase();
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const now = new Date();
    await ctx.db.query(
      `INSERT INTO documents (id, desk_id, hire_id, kind, state, number, object_key, customer_name, created_at, history)
       VALUES ($1,$2,$3,$4,'waiting',NULL,NULL,$5,$6,$7)`,
      [id, deskId, hire.rows[0].id, kind, customer.rows[0] ? String(customer.rows[0].name) : "", now.toISOString(), JSON.stringify([{ at: isoInstant(now), who: "Arranger", what: "Issued" }])]
    );
    try {
      const html = await documentHtml(ctx, deskId, hire.rows[0], kind, id);
      await ctx.db.query("UPDATE documents SET state='rendering' WHERE id=$1", [id]);
      const pdf = await renderPdf(ctx.cfg, html);
      const key = objectKeyForDocument(deskId, id);
      await s3Put(ctx.cfg, key, pdf, "application/pdf");
      const number = await takeNumber(ctx, deskId, kind, now);
      await ctx.db.query("UPDATE documents SET state='stored', number=$2, object_key=$3, history = history || $4::jsonb WHERE id=$1", [
        id,
        number,
        key,
        JSON.stringify([{ at: isoInstant(new Date()), who: "Arranger", what: "Stored" }]),
      ]);
      const after = await ctx.db.query("SELECT * FROM documents WHERE id=$1", [id]);
      res.status(201).json(documentOut(after.rows[0]));
    } catch (e) {
      await ctx.db.query("DELETE FROM documents WHERE id=$1", [id]);
      throw e;
    }
  });

  app.get("/api/documents/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const doc = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!doc.rows[0]) throw errors.notFound();
    res.json(documentOut(doc.rows[0]));
  });

  app.get("/api/documents/:id/file", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const doc = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!doc.rows[0]) throw errors.notFound();
    if (String(doc.rows[0].state) !== "stored") throw errors.notFound();
    const bytes = await s3Get(ctx.cfg, String(doc.rows[0].object_key));
    if (!bytes) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    const limit = await fileRateLimited(ctx, deskId, new Date(), "download");
    if (limit) throw errors.rateLimited(limit.seconds, limit.message);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  });
}

function documentOut(d: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(d.id),
    kind: String(d.kind),
    hireId: String(d.hire_id),
    state: String(d.state),
    number: d.number ? String(d.number) : null,
    objectKey: d.object_key ? String(d.object_key) : null,
    customerName: d.customer_name ? String(d.customer_name) : null,
    createdAt: isoInstant(new Date(String(d.created_at))),
    history: d.history ?? [],
  };
}

async function takeNumber(ctx: Ctx, deskId: string, kind: string, now: Date): Promise<string> {
  const prefix = kind === "invoice" ? "INV" : kind === "creditNote" ? "CN" : null;
  if (!prefix) return "";
  const year = Number(ukDateString(now).slice(0, 4));
  return tx(ctx.db, async (client) => {
    await client.query(
      "INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,$2,$3,0) ON CONFLICT (desk_id, kind_prefix, year) DO NOTHING",
      [deskId, prefix, year]
    );
    const r = await client.query<{ next: number }>(
      "UPDATE document_numbers SET last_number = last_number + 1 WHERE desk_id=$1 AND kind_prefix=$2 AND year=$3 RETURNING last_number AS next",
      [deskId, prefix, year]
    );
    return `${prefix}-${year}-${String(r.rows[0].next).padStart(4, "0")}`;
  });
}

export async function documentHtml(ctx: Ctx, deskId: string, hire: Record<string, unknown>, kind: string, id: string): Promise<string> {
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.customer_id]);
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.reference]);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hire.id]);
  const name = customer.rows[0] ? String(customer.rows[0].name) : "";
  const rows = vehicles
    .map((v) => `<tr><td>${v.seats} seats</td><td>${penniesToString(v.total)}</td><td>${penniesToString(v.deposit)}</td></tr>`)
    .join("");
  let total = 0;
  for (const v of vehicles) total += v.total;
  let body = "";
  if (kind === "seatPlan") {
    const seatsHtml = vehicles
      .map((v) => {
        const grid = seatGridFor(v.seats);
        const seated = new Map<string, string>();
        for (const p of passengers.rows) if (p.vehicle_id === v.id && p.seat) seated.set(String(p.seat), String(p.name));
        return `<h3>${v.seats}-seat vehicle</h3><table>${grid
          .map((s) => `<tr><td>${s}</td><td>${seated.get(s) ?? ""}</td></tr>`)
          .join("")}</table>`;
      })
      .join("");
    body = `<h2>Seat plan</h2>${seatsHtml}`;
  } else {
    body = `<h2>${kindLabel(kind)}</h2>
    <p>${escapeHtml(name)}</p>
    <p>Reference: ${escapeHtml(String(hire.reference))}</p>
    <p>Departure: ${escapeHtml(String(hire.depart_date))} ${escapeHtml(String(hire.depart_time))}</p>
    <p>Route:</p>
    <ul>${stops.rows.map((s) => `<li>${escapeHtml(String(s.text))}</li>`).join("")}</ul>
    <table><tr><th>Vehicle</th><th>Total</th><th>Deposit</th></tr>${rows}</table>
    <p>Total: ${penniesToString(total)}</p>`;
  }
  void id;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${kindLabel(kind)}</title>
  <style>
    @page { margin: 0; }
    body { font-family: 'Noto Sans', sans-serif; margin: 0; padding: 24px; }
    h1, h2, h3 { font-family: 'Noto Sans', sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #333; padding: 6px; text-align: left; }
  </style></head><body>
  <h1>Merrowfield Coach Hire</h1>
  ${body}
  </body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export { registerAftercareApi } from "./aftercare.js";
export { ukTimeHM, isoDate };
