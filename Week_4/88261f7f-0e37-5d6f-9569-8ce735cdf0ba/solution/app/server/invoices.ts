import type { Entry, Folio, Invoice } from "../shared/api";
import { isEmailAddress } from "../shared/email";
import { formatMoney } from "../shared/money";
import { database, inserted, one, run, atomic, type Row } from "./db";
import { fail, isUuid, ok, type Reply } from "./http";
import { emit } from "./live";
import { PdfUnavailable, renderPdf } from "./providers/gotenberg";
import { MailUnavailable, sendMail } from "./providers/smtp";
import { StoreUnavailable, getObject, putObject } from "./providers/s3";
import { balanceOf, foliosOf, invoiceView } from "./stayView";

const INVOICE_LOCK = 727_002;
const UNAVAILABLE = {
  pdf: "The invoice could not be created. The PDF service is unavailable. Nothing was saved.",
  store: "The invoice could not be created. The file store is unavailable. Nothing was saved.",
  files: "The file store is unavailable.",
  mail: "The invoice could not be emailed. The mail service is unavailable.",
};

interface InvoiceContext extends Row {
  folio_id: string; stay_id: string; state: "open" | "closed"; payer_name: string; payer_email: string;
  arrival: string; departure: string; hotel_name: string;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function invoiceHtml(number: string, context: InvoiceContext, roomNumber: string, entries: readonly Entry[]): string {
  const total = entries.filter((entry) => entry.kind === "charge").reduce((sum, entry) => sum + entry.amountCents, 0);
  const paid = entries.filter((entry) => entry.kind === "payment").reduce((sum, entry) => sum + entry.amountCents, 0);
  const lines = entries.map((entry) =>
    `<tr><td>${entry.date}</td><td>${escapeHtml(entry.description)}</td><td class="money">${formatMoney(entry.amountCents)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${number}</title><style>
body{font-family:Georgia,serif;color:#14211b;margin:48px}h1{font-size:28px;margin:0 0 4px}p{margin:2px 0}
table{border-collapse:collapse;width:100%;margin:20px 0}td{border-bottom:1px solid #24342b;padding:6px 8px}.money{text-align:right;font-variant-numeric:tabular-nums}
</style></head><body><h1>Invoice ${number}</h1><p>${escapeHtml(context.hotel_name)}</p>
<p>Bill to: ${escapeHtml(context.payer_name)}</p><p>Stay: ${context.arrival} to ${context.departure}</p><p>Room ${escapeHtml(roomNumber)}</p>
<table>${lines}</table><p>Total: ${formatMoney(total)}</p><p>Paid: ${formatMoney(paid)}</p><p>Balance: ${formatMoney(total - paid)}</p></body></html>`;
}

/** Closes a folio at zero: takes the next number, renders and stores the PDF, and commits only after the store accepted it. */
export async function closeFolio(hotelId: string, folioId: string): Promise<Reply> {
  const stayId = await atomic(async (client) => {
    const context = isUuid(folioId)
      ? await one<InvoiceContext>(
          client,
          `SELECT f.id AS folio_id, f.stay_id, f.state, f.payer_name, f.payer_email, s.arrival, s.departure, h.name AS hotel_name
           FROM folios f JOIN stays s ON s.id = f.stay_id JOIN hotels h ON h.id = f.hotel_id
           WHERE f.id = $1 AND f.hotel_id = $2 FOR UPDATE OF f`,
          [folioId, hotelId])
      : undefined;
    if (!context) throw fail.notFound();
    if (context.state === "closed") throw fail.conflict("This folio is closed.");
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [INVOICE_LOCK, hotelId]);
    const folios = await foliosOf(client, context.stay_id);
    const entries = (folios.find((candidate) => candidate.id === folioId) as Folio).entries;
    const balance = balanceOf(entries);
    if (balance !== 0) throw fail.conflict(`This folio still has a balance of ${formatMoney(balance)}.`);
    if (entries.length === 0) throw fail.conflict("This folio has no entries.");
    const { sequence } = await inserted<Row & { sequence: number }>(client, "SELECT COALESCE(max(sequence), 0) + 1 AS sequence FROM invoices WHERE hotel_id = $1", [hotelId]);
    const number = `INV-${String(sequence).padStart(6, "0")}`;
    const last = await inserted<Row & { number: string }>(
      client, `SELECT r.number FROM stay_nights n JOIN rooms r ON r.id = n.room_id WHERE n.stay_id = $1 ORDER BY n.night DESC LIMIT 1`, [context.stay_id]);
    try {
      const pdf = await renderPdf(invoiceHtml(number, context, last.number, entries));
      await putObject(`invoices/${hotelId}/${number}.pdf`, pdf, "application/pdf");
    } catch (failure) {
      if (failure instanceof PdfUnavailable) throw fail.unavailable(UNAVAILABLE.pdf);
      if (failure instanceof StoreUnavailable) throw fail.unavailable(UNAVAILABLE.store);
      throw failure;
    }
    await run(client, "INSERT INTO invoices (hotel_id, folio_id, sequence, number, bill_to_name, payer_email) VALUES ($1, $2, $3, $4, $5, $6)",
      [hotelId, folioId, sequence, number, context.payer_name, context.payer_email]);
    await run(client, "UPDATE folios SET state = 'closed' WHERE id = $1", [folioId]);
    await emit(client, hotelId, { type: "stay", stayId: context.stay_id, notice: null });
    return context.stay_id;
  });
  const folio = (await foliosOf(database(), stayId)).find((candidate) => candidate.id === folioId);
  return ok(folio);
}

interface InvoiceRecord extends Row { id: string; number: string; folio_id: string; mail_state: "not_sent" | "sent"; bill_to_name: string; payer_email: string; stay_id: string }

async function findInvoice(hotelId: string, invoiceId: string): Promise<InvoiceRecord> {
  const found = isUuid(invoiceId)
    ? await one<InvoiceRecord>(
        database(),
        "SELECT i.*, f.stay_id FROM invoices i JOIN folios f ON f.id = i.folio_id WHERE i.id = $1 AND i.hotel_id = $2",
        [invoiceId, hotelId])
    : undefined;
  if (!found) throw fail.notFound();
  return found;
}

async function pdfOf(hotelId: string, number: string): Promise<Buffer> {
  try {
    const stored = await getObject(`invoices/${hotelId}/${number}.pdf`);
    if (!stored) throw fail.unavailable(UNAVAILABLE.files);
    return stored;
  } catch (failure) {
    if (failure instanceof StoreUnavailable) throw fail.unavailable(UNAVAILABLE.files);
    throw failure;
  }
}

export async function invoicePdf(hotelId: string, invoiceId: string): Promise<Reply> {
  const invoice = await findInvoice(hotelId, invoiceId);
  return { status: 200, bytes: await pdfOf(hotelId, invoice.number), contentType: "application/pdf" };
}

export async function emailInvoice(hotelId: string, invoiceId: string): Promise<Reply> {
  const invoice = await findInvoice(hotelId, invoiceId);
  if (!isEmailAddress(invoice.payer_email)) throw fail.invalid({ payerEmail: "Enter the payer's email address." });
  const hotel = await inserted<Row & { name: string }>(database(), "SELECT name FROM hotels WHERE id = $1", [hotelId]);
  const bytes = await pdfOf(hotelId, invoice.number);
  try {
    await sendMail({
      to: invoice.payer_email,
      subject: `Invoice ${invoice.number} from ${hotel.name}`,
      text: `Your invoice ${invoice.number} is attached.\r\n`,
      attachment: { fileName: `${invoice.number}.pdf`, contentType: "application/pdf", bytes },
    });
  } catch (failure) {
    if (failure instanceof MailUnavailable) throw fail.unavailable(UNAVAILABLE.mail);
    throw failure;
  }
  await atomic(async (client) => {
    await run(client, "UPDATE invoices SET mail_state = 'sent' WHERE id = $1", [invoiceId]);
    await emit(client, hotelId, { type: "stay", stayId: invoice.stay_id, notice: null });
  });
  const updated: Invoice = invoiceView({ ...invoice, mail_state: "sent" });
  return ok(updated);
}

