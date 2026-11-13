// The deposit: preconditions in order, then all or nothing across Kill Bill, the receipt and Postgres.
import { randomUUID } from "node:crypto";
import { services as listServices } from "../content.js";
import { one, pool, transaction } from "../db.js";
import { documentHtml, renderPdf } from "../documents.js";
import { ApiError } from "../errors.js";
import * as killbill from "../killbill.js";
import { emailReachable, sendEmail } from "../mail.js";
import { queueEmail, queuePush } from "../outbox.js";
import { checkCard } from "./cards.js";
import { contactEmail, engagementJson, loadEngagement, setStage, stageOf } from "./engagements.js";
import { currentModel } from "./intake.js";
import { invoiceById, noticeContext, recordDepositInvoice } from "./invoices.js";
import { depositPush, depositReceipt } from "./notices.js";
import { lockQuote, readQuote } from "./quote.js";
import { depositTransition } from "./states.js";
import type { Outcome } from "./idempotency.js";
import type { Currency } from "../../shared/money.js";

type Captured = { account: string; invoiceId: string | null; itemId: string | null; paymentId: string | null };

/** Leaves the attempt netting to nothing in Kill Bill: refund-and-adjust a captured payment, or void an unpaid invoice. */
async function undo(engagementId: string, captured: Captured, deposit: number, currency: Currency): Promise<void> {
  if (captured.paymentId && captured.itemId) {
    await killbill.refundPayment(captured.paymentId, currency, deposit, `${engagementId}:undo:${captured.paymentId}`, captured.itemId).catch(() => undefined);
  } else if (captured.invoiceId) {
    await killbill.voidInvoice(captured.invoiceId).catch(() => undefined);
  }
}

export async function payDeposit(brandId: string, engagementId: string, body: Record<string, unknown>, origin: string, now: Date): Promise<Outcome> {
  const result = await transaction(async (client) => {
    const engagement = await loadEngagement(client, engagementId, brandId, true);
    const next = depositTransition(stageOf(engagement));
    const lines = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM quote_lines WHERE engagement_id = $1", [engagementId]);
    if (!lines?.n) throw new ApiError("quote_empty");
    const model = await currentModel(client, engagementId);
    if (!model || model.measurement === "failed") throw new ApiError("model_missing");
    if (model.measurement !== "measured") throw new ApiError("measurement_pending");
    if (model.needs_unit_confirmation) throw new ApiError("unit_unconfirmed");
    const card = checkCard(body.card, now);
    if (!card.approves) throw new ApiError("card_declined");
    const quote = await readQuote(client, engagement, await listServices(), now);
    const deposit = quote.milestones.deposit_minor;
    if (!(await emailReachable())) throw new ApiError("email_unavailable");
    const financeEmail = await contactEmail(client, engagement.brand_id, "finance");
    const account = await killbill.ensureAccount({ id: engagement.brand_id, name: engagement.brand_name, currency: engagement.currency }, financeEmail);
    const captured: Captured = { account, invoiceId: null, itemId: null, paymentId: null };
    try {
      captured.invoiceId = await killbill.createChargeInvoice(account, engagement.currency, [{ description: `Deposit ${engagement.reference}`, amount_minor: deposit }]);
      const created = await killbill.getInvoice(captured.invoiceId);
      captured.itemId = created.items[0]?.invoiceItemId ?? null;
      captured.paymentId = await killbill.payInvoice(account, captured.invoiceId, engagement.currency, deposit);
      const confirmed = await killbill.getInvoice(captured.invoiceId);
      if (confirmed.balance !== 0) throw new ApiError("billing_unavailable");
      await lockQuote(client, engagement, quote, now);
      const invoiceId = await recordDepositInvoice(client, engagementId, engagement.reference, deposit, { invoiceId: captured.invoiceId, number: String(confirmed.invoiceNumber) }, now);
      const entryId = randomUUID();
      await client.query(
        "INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id, created_at) VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7)",
        [entryId, engagementId, deposit, engagement.currency, invoiceId, captured.paymentId, now],
      );
      await client.query("UPDATE brands SET killbill_account_id = $2 WHERE id = $1", [engagement.brand_id, account]);
      await setStage(client, engagementId, next);
      const locked = await loadEngagement(client, engagementId, brandId);
      const context = await noticeContext(client, locked, origin, now);
      await queuePush(client, depositPush(context, deposit));
      const receipt = depositReceipt(context, financeEmail, deposit, String(confirmed.invoiceNumber));
      const pdf = receipt.pdf ? await renderPdf(documentHtml(receipt.pdf.document)).catch(() => null) : null;
      if (pdf && receipt.pdf) await sendEmail({ to: receipt.to, subject: receipt.subject, text: receipt.text, attachment: { filename: receipt.pdf.filename, content: pdf } });
      else await queueEmail(client, receipt);
      return { invoiceId, entryId };
    } catch (error) {
      await undo(engagementId, captured, deposit, engagement.currency);
      throw error;
    }
  });
  const engagement = await loadEngagement(pool, engagementId, brandId);
  const entry = await one<Record<string, unknown> & { created_at: Date }>(
    pool,
    "SELECT id, kind, amount_minor, currency, invoice_id, killbill_payment_id, created_at FROM ledger_entries WHERE id = $1",
    [result.entryId],
  );
  return {
    status: 201,
    body: {
      engagement: await engagementJson(pool, engagement, "client", now),
      invoice: await invoiceById(pool, result.invoiceId),
      ledger_entry: { ...entry, created_at: entry?.created_at.toISOString() },
    },
  };
}
