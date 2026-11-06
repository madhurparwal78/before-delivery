import { Router } from "express";
import { createHmac } from "node:crypto";
import { query } from "../db";
import { errors, HttpError } from "../http";
import { auditSystem } from "../audit";
import { killbill, mailer, storage } from "../services";
import { payInvoiceAllOrNothing, billingContacts, workspaceName, subRow } from "./billing";
import { formatMoney, formatDateTime } from "../http";

export const webhookRouter = Router();

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

webhookRouter.post("/billing/webhook", async (req, res, next) => {
  try {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from("");
    const body = JSON.parse(rawBody.toString("utf8")) as {
      id?: string;
      type?: string;
      workspaceId?: string;
      invoiceId?: string;
      amountCents?: number;
      paymentId?: string;
      reason?: string;
    };
    const signature = req.headers["orrery-signature"];
    if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
      throw new HttpError(401, { error: "invalid_signature" });
    }
    const wsRes = await query("SELECT id, gateway_secret, time_zone FROM workspaces WHERE id = $1", [body.workspaceId]);
    const ws = wsRes.rows[0] as { id: string; gateway_secret: string; time_zone: string } | undefined;
    if (!ws) throw new HttpError(401, { error: "invalid_signature" });
    const expected = createHmac("sha256", ws.gateway_secret).update(rawBody).digest("hex");
    if (signature.slice(7) !== expected) throw new HttpError(401, { error: "invalid_signature" });

    if (typeof body.id !== "string" || !body.id) throw errors.validation({ id: "Required" });

    // Idempotency per event ID, checked before any processing.
    const seen = await query("SELECT body_hash FROM webhook_events WHERE id = $1", [body.id]);
    const bodyHash = createHmac("sha256", "orrery-body-hash").update(rawBody).digest("hex");
    const prior = seen.rows[0] as { body_hash: string } | undefined;
    if (prior) {
      if (prior.body_hash !== bodyHash) throw errors.conflict("idempotency_key_reused");
      res.json({ received: true, duplicate: true });
      return;
    }

    if (body.type !== "payment.succeeded" && body.type !== "payment.failed") {
      throw errors.validation({ type: "Unknown event type" });
    }

    const sub = await subRow(ws.id);
    if (!sub.kb_account_id) throw errors.serviceUnavailable("billing");

    if (body.type === "payment.succeeded") {
      const invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws.id, body.invoiceId])).rows[0] as { id: string; balance_cents: number; number: string; status: string } | undefined;
      if (!invoiceRow) throw errors.notFound();
      if (invoiceRow.balance_cents > 0) {
        if (typeof body.amountCents !== "number" || body.amountCents !== invoiceRow.balance_cents) {
          throw errors.validation({ amountCents: "Amount must match the invoice balance" });
        }
        await payInvoiceAllOrNothing({
          workspaceId: ws.id,
          accountId: sub.kb_account_id,
          invoiceId: invoiceRow.id,
          amountCents: body.amountCents,
          transactionExternalKey: `${ws.id}:event-${body.id}`,
        });
        auditSystem(ws.id, "invoice.paid", { type: "invoice", id: invoiceRow.id });
        // Reactivation when no unpaid invoices remain.
        const fresh = await subRow(ws.id);
        if (fresh.state === "past_due" || (fresh.state === "suspended" && fresh.dunning_failed_at !== null)) {
          const unpaid = await query("SELECT count(*) AS c FROM invoices WHERE workspace_id = $1 AND status = 'unpaid'", [ws.id]);
          if (Number((unpaid.rows[0] as { c: string }).c) === 0) {
            await query("UPDATE subscriptions SET state = 'active', grace_ends_at = NULL, dunning_failed_at = NULL WHERE workspace_id = $1", [ws.id]);
            auditSystem(ws.id, "subscription.reactivated", { type: "workspace", id: ws.id });
          }
        }
      }
      await query("INSERT INTO webhook_events (id, workspace_id, body_hash) VALUES ($1,$2,$3)", [body.id, ws.id, bodyHash]);
      res.json({ received: true, duplicate: false });
      return;
    }

    // payment.failed: a settled payment did not settle after all. Record a chargeback.
    const paymentRow = (await query("SELECT * FROM payments WHERE workspace_id = $1 AND id = $2", [ws.id, body.paymentId])).rows[0] as { id: string; invoice_id: string; amount_cents: number; refunded_cents: number } | undefined;
    if (!paymentRow) throw errors.notFound();
    const payments = await killbill().listInvoicePayments(sub.kb_account_id);
    const kbPayment = payments.find((p) => p.paymentId === paymentRow.id);
    if (!kbPayment) throw errors.notFound();
    const alreadyChargedBack = kbPayment.transactions.some((t) => t.transactionType === "CHARGEBACK");
    if (!alreadyChargedBack) {
      await killbill().chargebackPayment(paymentRow.id, paymentRow.amount_cents / 100);
      const kbInvoice = await killbill().getInvoice(paymentRow.invoice_id);
      await query("UPDATE invoices SET balance_cents = $2, status = $3 WHERE workspace_id = $1 AND id = $4", [ws.id, Math.round(kbInvoice.balance * 100), kbInvoice.balance > 0.001 ? "unpaid" : "paid", paymentRow.invoice_id]);
    }
    if (sub.state === "active") {
      const failedAt = new Date();
      const dunningDaySeconds = Number(process.env.DUNNING_DAY_SECONDS ?? 86400);
      const graceEndsAt = new Date(failedAt.getTime() + 7 * dunningDaySeconds * 1000);
      await query("UPDATE subscriptions SET state = 'past_due', dunning_failed_at = $2, grace_ends_at = $3, dunning_notices = $4 WHERE workspace_id = $1", [ws.id, failedAt, graceEndsAt, JSON.stringify({ sent: [0], failedAt: iso(failedAt) })]);
      auditSystem(ws.id, "subscription.past_due", { type: "workspace", id: ws.id });
      const contacts = await billingContacts(ws.id);
      const name = await workspaceName(ws.id);
      if (contacts.length > 0) {
        mailer().send({
          to: contacts,
          subject: `Payment failed for ${name}`,
          text: `A payment failed for ${name}. The workspace is now past due.\n\nGrace period ends ${formatDateTime(graceEndsAt, ws.time_zone)}.\n`,
        });
      }
    }
    await query("INSERT INTO webhook_events (id, workspace_id, body_hash) VALUES ($1,$2,$3)", [body.id, ws.id, bodyHash]);
    res.json({ received: true, duplicate: false });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("KillBill")) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});
