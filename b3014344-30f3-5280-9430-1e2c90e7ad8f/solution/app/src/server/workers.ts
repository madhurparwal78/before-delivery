import { query, rows, tx } from "./db";
import { renderPdf, type PdfLine } from "./documents";
import * as billing from "./killbill";
import { deliverQueued } from "./mail";
import { settle } from "./orders";
import { discoverRenewals, runDueAttempts } from "./plans";
import { seed } from "./seed";
import { objectKeys, putObject } from "./storage";
import { longDate } from "../shared/domain";
import { formatMoney, type Currency } from "../shared/money";

// Background work runs in every process; row locks (FOR UPDATE SKIP LOCKED) and unique keys make
// each email, PDF, dunning attempt and seed step happen once however many processes share the ledger.

function invoicePdf(inv: billing.KbInvoice, businessName: string, orderNumber: string): Buffer {
  const currency = inv.currency as Currency;
  const lines: PdfLine[] = [
    { text: "Pampero Build Co.", x: 56, y: 770, size: 20, font: "bold" },
    { text: "Web design and build, Buenos Aires", x: 56, y: 750, size: 10 },
    { text: `Invoice ${inv.invoiceNumber}`, x: 539, y: 770, size: 16, font: "bold", align: "right" },
    { text: `Date ${longDate(inv.invoiceDate)}`, x: 539, y: 750, size: 10, align: "right" },
    { text: "Billed to", x: 56, y: 700, size: 9 },
    { text: businessName, x: 56, y: 684, size: 13, font: "bold" },
    { text: `Order ${orderNumber}`, x: 56, y: 668, size: 10 },
    { text: `Currency ${currency}`, x: 539, y: 684, size: 10, align: "right" },
    { text: "Description", x: 56, y: 620, size: 9, font: "bold" },
    { text: "Amount", x: 539, y: 620, size: 9, font: "bold", align: "right" },
  ];
  let y = 596;
  for (const item of inv.items.filter((i) => i.itemType !== "CBA_ADJ" || billing.kbMinor(i.amount) !== 0n)) {
    const label =
      item.itemType === "REPAIR_ADJ"
        ? "Credit for unused days"
        : item.itemType === "CBA_ADJ"
          ? "Account credit applied"
          : item.description && item.itemType === "EXTERNAL_CHARGE"
            ? item.description
            : `${item.planName?.startsWith("care-plus") ? "Care Plus" : "Care Lite"}, ${item.startDate ?? ""} to ${item.endDate ?? ""}`;
    lines.push({ text: label, x: 56, y, size: 10 });
    lines.push({ text: formatMoney(billing.kbMinor(item.amount), currency), x: 539, y, size: 10, font: "mono", align: "right" });
    y -= 20;
  }
  lines.push({ text: "Total", x: 56, y: y - 16, size: 11, font: "bold" });
  lines.push({ text: formatMoney(billing.kbMinor(inv.amount), currency), x: 539, y: y - 16, size: 11, font: "mono", align: "right" });
  lines.push({ text: "Balance", x: 56, y: y - 36, size: 11, font: "bold" });
  lines.push({ text: formatMoney(billing.kbMinor(inv.balance), currency), x: 539, y: y - 36, size: 11, font: "mono", align: "right" });
  return renderPdf({
    lines,
    rules: [
      { x1: 56, y1: 610, x2: 539, y2: 610 },
      { x1: 56, y1: y + 4, x2: 539, y2: y + 4, rgb: [217, 72, 38], width: 1.2 },
    ],
  });
}

/** Stores a PDF for every invoice the ledger tracks, once its payment (if any) has settled. */
async function storePdfs(): Promise<void> {
  for (let more = true; more; ) {
    more = await tx(async (db) => {
      const [row] = await rows<{ kb_invoice_id: string; order_id: string; number: string; business_name: string }>(
        db,
        `SELECT d.kb_invoice_id, d.order_id, o.number, a.business_name FROM invoice_pdfs d
         JOIN orders o ON o.id = d.order_id JOIN client_accounts a ON a.id = o.account_id
         WHERE d.stored_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.kb_invoice_id = d.kb_invoice_id AND NOT p.settled)
         ORDER BY d.created_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      );
      if (!row) return false;
      const inv = await billing.invoice(row.kb_invoice_id);
      if (!inv || inv.status === "VOID") {
        await db.query("DELETE FROM invoice_pdfs WHERE kb_invoice_id = $1", [row.kb_invoice_id]);
        return true;
      }
      await putObject(objectKeys.invoice(row.order_id, inv.invoiceId), invoicePdf(inv, row.business_name, row.number));
      await db.query("UPDATE invoice_pdfs SET stored_at = now() WHERE kb_invoice_id = $1", [row.kb_invoice_id]);
      return true;
    });
  }
}

/** Retries settling captured invoices whose settlement did not reach Kill Bill. */
async function settleCaptured(): Promise<void> {
  const pending = await query<{ id: string; order_id: string; kind: string; amount_minor: string; kb_invoice_id: string; kb_account_id: string }>(
    `SELECT p.id, p.order_id, p.kind, p.amount_minor, p.kb_invoice_id, a.kb_account_id FROM payments p
     JOIN orders o ON o.id = p.order_id JOIN client_accounts a ON a.id = o.account_id
     WHERE NOT p.settled AND a.kb_account_id IS NOT NULL AND p.captured_at < now() - interval '5 seconds'`,
  );
  for (const p of pending) {
    const inv = await billing.invoice(p.kb_invoice_id);
    const open = inv ? billing.kbMinor(inv.balance) : 0n;
    const amount = BigInt(p.amount_minor) < open ? BigInt(p.amount_minor) : open;
    if (amount <= 0n) await query("UPDATE payments SET settled = true WHERE id = $1", [p.id]);
    else await settle({ kbAccountId: p.kb_account_id, invoiceId: p.kb_invoice_id, amount, paymentId: p.id });
  }
}

function every(ms: number, name: string, work: () => Promise<void>): void {
  let running = false;
  let lastError = "";
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await work();
      lastError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) console.warn(`[${name}] ${message}`);
      lastError = message;
    } finally {
      running = false;
    }
  };
  setInterval(tick, ms).unref();
  void tick();
}

export function startWorkers(): void {
  every(5_000, "seed", seed);
  every(2_000, "mail", deliverQueued);
  every(3_000, "pdf", storePdfs);
  every(1_000, "dunning", runDueAttempts);
  every(15_000, "renewals", discoverRenewals);
  every(10_000, "settlement", settleCaptured);
}
