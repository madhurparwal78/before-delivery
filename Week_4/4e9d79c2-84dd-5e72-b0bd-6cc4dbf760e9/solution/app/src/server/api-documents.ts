import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import { hireMoney, requireHire, vehiclesOf, type VehicleMoney } from "./domain.js";
import { ApiError, conflict, limitReached, instantText, newId, notFound, ok, refused, unavailable, route, type ApiRoute, type Ctx } from "./http.js";
import { getObject, ProviderDown, putObject, renderPdf } from "./providers.js";
import { stopsOf } from "./api-enquiries.js";
import { adultsLine, passengersOf, seatsJson } from "./api-seats.js";
import { copyFor, dateIn, type Language } from "../shared/strings.js";
import { escapeHtml } from "./html.js";
import { money, printedMoney } from "../shared/rules.js";
import { ukDate } from "../shared/time.js";
import type { DeskRow, CustomerRow, HireRow, StopRow, DocumentRow } from "./records.js";

const PDF_DOWN = "The PDF service is unavailable right now. Nothing was saved.";
const STORE_DOWN = "The file store is unavailable right now. Nothing was saved.";
const KINDS: Record<string, string> = { quote: "Quote", confirmationLetter: "Confirmation letter", invoice: "Invoice", creditNote: "Credit note", seatPlan: "Seat plan" };
export const kindName = (kind: string): string => KINDS[kind];
const NUMBERED: Record<string, string> = { invoice: "INV", creditNote: "CN" };

const fontFace = (family: string, file: string, weight: number): string => {
  const data = readFileSync(fileURLToPath(new URL(`../../public/fonts/${file}`, import.meta.url))).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
};
let printFonts: string | null = null;
const fonts = (): string => {
  printFonts ??= ["400", "700"].flatMap((w) => [fontFace("Doc", `noto-sans-latin-${w}-normal.woff2`, Number(w)), fontFace("Doc", `noto-sans-latin-ext-${w}-normal.woff2`, Number(w))]).join("")
    + fontFace("DocUrdu", "noto-nastaliq-urdu-arabic-400-normal.woff2", 400);
  return printFonts;
};

const page = (language: Language, title: string, number: string | null, body: string): string =>
  `<!doctype html><html lang="${language}" dir="${language === "ur" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${fonts()}
  body{font-family:"Doc","DocUrdu",sans-serif;color:#000;font-size:12pt;line-height:${language === "ur" ? 2 : 1.5};margin:0}
  header{background:#33044a;color:#fff;padding:18pt 24pt}header h1{margin:0;font-size:20pt}header p{margin:4pt 0 0}
  main{padding:18pt 24pt}table{border-collapse:collapse;width:100%;margin:10pt 0}th{background:#33044a;color:#fff;text-align:start;padding:5pt}td{border-bottom:1px solid #33044a;padding:5pt;overflow-wrap:anywhere}
  .amount{text-align:end;font-variant-numeric:tabular-nums}.seat{display:inline-block;width:23%;border:1px solid #33044a;margin:2pt;padding:3pt;font-size:9pt;overflow-wrap:anywhere;vertical-align:top}</style></head>
  <body><header><p>Merrowfield Coach Hire, Coventry</p><h1>${escapeHtml(title)}</h1>${number ? `<p>${escapeHtml(number)}</p>` : ""}</header><main>${body}</main></body></html>`;

interface DocumentFacts { hire: HireRow; customer: CustomerRow; vehicles: VehicleMoney[]; stops: StopRow[]; language: Language }
const facts = async (db: Db, hire: HireRow): Promise<DocumentFacts> => {
  const customer = await only<CustomerRow>(db, "SELECT * FROM customers WHERE id=$1", [hire.customer_id]);
  return { hire, customer, vehicles: await vehiclesOf(db, hire.id), stops: await stopsOf(db, hire.id), language: (customer?.language ?? "en") as Language };
};
const summary = ({ hire, stops, vehicles, language }: DocumentFacts): string => {
  const t = copyFor(language);
  const lines = vehicles.map((v, i) => `<tr><td>${i + 1}</td><td>${v.seats}</td><td class="amount">${money(v.total)}</td><td class="amount">${money(v.deposit)}</td></tr>`).join("");
  return `<p><strong>${escapeHtml(t.route)}:</strong> ${stops.map((s) => escapeHtml(s.text)).join(" → ")}</p>
    <p><strong>${escapeHtml(t.out)}:</strong> ${dateIn(language, hire.depart_date)} ${hire.depart_time}${hire.return_date ? ` · <strong>${escapeHtml(t.returnLabel)}:</strong> ${dateIn(language, hire.return_date)} ${hire.return_time}` : ""}</p>
    <p><strong>${escapeHtml(t.party)}:</strong> ${escapeHtml(t.people(hire.party.people))}</p>
    <table><thead><tr><th>${escapeHtml(t.vehicles)}</th><th>Seats</th><th class="amount">${escapeHtml(t.total)}</th><th class="amount">${escapeHtml(t.deposit)}</th></tr></thead><tbody>${lines}</tbody></table>
    <p><strong>${escapeHtml(t.total)}:</strong> ${money(vehicles.reduce((a, v) => a + v.total, 0))}</p>`;
};
const documentHtml = async (db: Db, hire: HireRow, kind: string, number: string | null): Promise<string> => {
  const f = await facts(db, hire);
  const name = escapeHtml(hire.name ?? "Erased customer");
  const head = `<p><strong>${name}</strong></p>`;
  const reference = `<p>Reference ${hire.id}</p>`;
  if (kind === "seatPlan") {
    const seats = await seatsJson(db, hire.id);
    const passengers = await passengersOf(db, hire.id);
    const named = (id: string | null): string => escapeHtml(passengers.find((p) => p.id === id)?.name ?? "");
    const adults = adultsLine(hire, passengers);
    const grids = seats.vehicles.map((v) => `<h2>${v.seats} seats</h2><div>${v.grid.map((s) => `<span class="seat"><strong>${s.seat}</strong><br>${named(s.passengerId)}</span>`).join("")}</div>
      <table><thead><tr><th>Name</th><th class="amount">Share</th></tr></thead><tbody>${v.split.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="amount">${printedMoney(s.amount)}</td></tr>`).join("")}</tbody></table>`).join("");
    return page(f.language, `Seat plan ${hire.id}`, null, `${head}${adults.adultsShort ? `<p>${adults.adultsShort} more adults are needed</p>` : ""}${grids}`);
  }
  const money_ = await hireMoney(db, hire.id, f.vehicles);
  if (kind === "invoice" || kind === "creditNote") {
    const words = kind === "invoice" ? "Invoice" : "Credit note";
    return page(f.language, `${words} ${hire.id}`, number, `${head}${reference}${summary(f)}<p><strong>Paid:</strong> ${money(money_.paid)}</p><p><strong>Owed:</strong> ${money(money_.owed)}</p>`);
  }
  if (kind === "confirmationLetter") return page(f.language, `Confirmation letter ${hire.id}`, null, `${head}<p>Your hire ${hire.id} is confirmed with Merrowfield Coach Hire.</p>${summary(f)}`);
  return page(f.language, copyFor(f.language).yourQuote(hire.id), null, `${head}${summary(f)}<p>${escapeHtml(copyFor(f.language).validUntil(dateIn(f.language, ukDate(hire.quote_ends_at ?? nowSeconds()))))}</p><p>${escapeHtml(copyFor(f.language).payBy(hire.id))}</p>`);
};

const documentJson = (d: DocumentRow): Record<string, unknown> => ({
  id: d.id, kind: d.kind, hireId: d.hire_id, state: d.state, number: d.number, objectKey: d.object_key, customerName: d.customer_name, createdAt: instantText(d.created_at), history: d.history,
});
export const documentsOf = async (deskId: string): Promise<DocumentRow[]> => rows<DocumentRow>(pool, "SELECT * FROM documents WHERE desk_id=$1 ORDER BY created_seq DESC", [deskId]);
export const nextNumbers = async (deskId: string): Promise<{ nextInvoice: string; nextCreditNote: string }> => {
  const year = Number(ukDate(nowSeconds()).slice(0, 4));
  const last = async (kind: string): Promise<number> => (await one<{ last: number }>(pool, "SELECT last FROM number_counters WHERE desk_id=$1 AND kind=$2 AND year=$3", [deskId, kind, year]))?.last ?? 0;
  const text = (prefix: string, n: number): string => `${prefix}-${year}-${String(n + 1).padStart(4, "0")}`;
  return { nextInvoice: text("INV", await last("invoice")), nextCreditNote: text("CN", await last("creditNote")) };
};
const stamp = (what: string, who: string, at = nowSeconds()): { at: string | null; who: string; what: string } => ({ at: instantText(at), who, what });

/** Makes one document: it shows from the start, and takes its number only in the transaction that stores its PDF. */
const makeDocument = async (hire: HireRow, kind: string, who: string): Promise<DocumentRow> => {
  const id = newId("DC");
  const key = `desks/${hire.desk_id}/documents/${id}.pdf`;
  const now = nowSeconds();
  await pool.query("INSERT INTO documents (id,desk_id,hire_id,kind,state,customer_name,created_at,history) VALUES ($1,$2,$3,$4,'waiting',$5,$6,$7)",
    [id, hire.desk_id, hire.id, kind, hire.name, now, JSON.stringify([stamp("Asked for", who, now)])]);
  try {
    await pool.query("UPDATE documents SET state='rendering',history=history||$2 WHERE id=$1", [id, JSON.stringify([stamp("Sent to the PDF service", who)])]);
    return await transaction(async (tx) => {
      let number: string | null = null;
      const prefix = NUMBERED[kind];
      if (prefix) {
        const year = Number(ukDate(nowSeconds()).slice(0, 4));
        const counter = await only<{ last: number }>(tx, "INSERT INTO number_counters (desk_id,kind,year,last) VALUES ($1,$2,$3,1) ON CONFLICT (desk_id,kind,year) DO UPDATE SET last=number_counters.last+1 RETURNING last", [hire.desk_id, kind, year]);
        number = `${prefix}-${year}-${String(counter.last).padStart(4, "0")}`;
      }
      let pdf: Buffer;
      try {
        pdf = await renderPdf(await documentHtml(tx, hire, kind, number));
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("pdfDown", PDF_DOWN);
        throw error;
      }
      try {
        await putObject(key, pdf, "application/pdf");
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreDown", STORE_DOWN);
        throw error;
      }
      return only<DocumentRow>(tx, "UPDATE documents SET state='stored',number=$2,object_key=$3,history=history||$4 WHERE id=$1 RETURNING *", [id, number, key, JSON.stringify([stamp("Stored", who)])]);
    });
  } catch (error) {
    await pool.query("DELETE FROM documents WHERE id=$1", [id]);
    throw error;
  }
};
/** The seeded invoice takes no further number: its PDF lands once both services answer. */
export const storeWaitingDocuments = async (): Promise<void> => {
  const waiting = await rows<DocumentRow>(pool, "SELECT * FROM documents WHERE state='waiting' AND number IS NOT NULL");
  for (const document of waiting) {
    const hire = await only<HireRow>(pool, "SELECT * FROM hires WHERE id=$1", [document.hire_id]);
    const key = `desks/${document.desk_id}/documents/${document.id}.pdf`;
    try {
      await putObject(key, await renderPdf(await documentHtml(pool, hire, document.kind, document.number)), "application/pdf");
      const desk = await only<Pick<DeskRow, "name">>(pool, "SELECT name FROM desks WHERE id=$1", [document.desk_id]);
      await pool.query("UPDATE documents SET state='stored',object_key=$2,history=history||$3 WHERE id=$1", [document.id, key, JSON.stringify([stamp("Stored", desk.name)])]);
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
    }
  }
};
/** The customer's copy of the quote: the stored one, rendered first if there is none. */
export const renderedQuote = async (hire: HireRow): Promise<Buffer> => {
  const stored = await one<DocumentRow>(pool, "SELECT * FROM documents WHERE hire_id=$1 AND kind='quote' AND state='stored' AND created_at>=$2 ORDER BY created_seq DESC LIMIT 1", [hire.id, hire.quote_changed_at ?? hire.quote_sent_at ?? 0]);
  if (stored) return getObject(stored.object_key as string);
  const desk = await only<Pick<DeskRow, "name">>(pool, "SELECT name FROM desks WHERE id=$1", [hire.desk_id]);
  try {
    return await getObject((await makeDocument(hire, "quote", desk.name)).object_key as string);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw new ProviderDown("quote");
    throw error;
  }
};

const downloadLimit = async (ctx: Ctx): Promise<void> => {
  if (!ctx.desk) return;
  const now = nowSeconds();
  const recent = await rows<{ at: number }>(pool, "SELECT at FROM downloads WHERE desk_id=$1 AND at>$2 ORDER BY at", [ctx.desk.id, now - config.fileRateWindow]);
  if (recent.length >= 5) {
    throw limitReached("tooManyDownloads", (time) => `You have downloaded several files. Try again after ${time}.`, recent[0].at + config.fileRateWindow, now);
  }
};
const loadDocument = async (ctx: Ctx): Promise<DocumentRow> => {
  const document = await one<DocumentRow>(pool, "SELECT * FROM documents WHERE id=$1 AND desk_id=$2", [ctx.params.id, ctx.desk!.id]);
  if (!document) throw notFound();
  return document;
};

export const documentRoutes: ApiRoute[] = [
  route({ method: "GET", path: "/api/documents", run: async ({ desk }) => ok({ documents: (await documentsOf(desk!.id)).map(documentJson), ...(await nextNumbers(desk!.id)) }) }),
  route({
    method: "POST", path: "/api/hires/:id/documents", body: "json", load: (ctx) => requireHire(pool, ctx.desk!.id, ctx.params.id),
    run: async ({ json, desk, loaded }) => {
      if (!KINDS[json.kind]) throw refused("Choose a kind of document.", "kind");
      if (loaded.accepted_at === null) throw conflict("noAcceptedQuote", "This hire has no accepted quote yet.");
      return ok(documentJson(await makeDocument(loaded, json.kind, desk!.name)), 201);
    },
  }),
  route({ method: "GET", path: "/api/documents/:id", load: loadDocument, run: async ({ loaded }) => ok(documentJson(loaded)) }),
  route({
    method: "GET", path: "/api/documents/:id/file", rateLimit: downloadLimit, load: loadDocument,
    run: async ({ desk, loaded }) => {
      if (loaded.erased) throw new ApiError(410, "erased", "This file went when its customer was erased.");
      if (loaded.state !== "stored") throw notFound();
      try {
        const data = await getObject(loaded.object_key as string);
        await pool.query("INSERT INTO downloads (desk_id,at) VALUES ($1,$2)", [desk!.id, nowSeconds()]);
        return { status: 200, raw: data, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${loaded.number ?? loaded.id}.pdf"` } };
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreDown", STORE_DOWN);
        throw error;
      }
    },
  }),
];
