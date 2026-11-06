// Goodwill credits: $1.00 to $25.00 onto the customer's Kill Bill account,
// with the version check, one notice and one audit entry.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale } from "../core/catalog.js";
import { message, fieldMessage } from "../core/copy.js";
import { money } from "../core/money.js";
import { hasControlChars } from "./text.js";
import { creditEmail } from "../core/emails.js";
import { queueNotice, type Outbox } from "../services/outbox.js";
import { KillBillClient, KillBillError, centsToKb } from "../services/killbill.js";
import type { CreditRecord } from "./views.js";
import { writeAudit, type AuditActor } from "./audit.js";
import { orderFromRow } from "./refunds.js";

export interface CreditInput {
  target: string;
  amountCents: number;
  reason: string;
}

export async function loadTargetForCredit(
  client: PoolClient,
  target: string
): Promise<{ kind: "order" | "subscription"; customerId: number; email: string; locale: string; version: number }> {
  const order = await client.query("SELECT * FROM orders WHERE number = $1 FOR UPDATE", [target]);
  if (order.rows[0]) {
    const lines = await client.query(
      "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
      [order.rows[0].id]
    );
    const record = orderFromRow(order.rows[0], lines.rows);
    const customer = await client.query("SELECT id, email, locale FROM customers WHERE id = $1", [order.rows[0].customer_id]);
    return { kind: "order", customerId: customer.rows[0].id, email: customer.rows[0].email, locale: customer.rows[0].locale, version: record.version };
  }
  const subscription = await client.query("SELECT * FROM subscriptions WHERE number = $1 FOR UPDATE", [target]);
  if (subscription.rows[0]) {
    const customer = await client.query("SELECT id, email, locale FROM customers WHERE id = $1", [subscription.rows[0].customer_id]);
    return {
      kind: "subscription", customerId: customer.rows[0].id, email: customer.rows[0].email,
      locale: customer.rows[0].locale, version: subscription.rows[0].version as number
    };
  }
  throw new ApiError(404, "not_found");
}

export async function addCredit(
  pool: Pool,
  kb: KillBillClient,
  outbox: Outbox,
  locale: Locale,
  actor: AuditActor,
  ifMatchVersion: number | null,
  input: CreditInput
): Promise<CreditRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targetInfo = await loadTargetForCredit(client, input.target);
    if (ifMatchVersion === null) {
      throw new ApiError(428, "precondition_required");
    }
    if (targetInfo.version !== ifMatchVersion) {
      throw new ApiError(412, "stale_version", message("stale_version", locale));
    }
    const fields = validateCredit(locale, input);
    if (Object.keys(fields).length > 0) {
      throw new ApiError(422, "invalid", null, fields);
    }
    const counter = await client.query("SELECT value FROM counters WHERE name = 'credit' FOR UPDATE");
    const creditNumber = `CR-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'credit'");
    const insert = await client.query(
      `INSERT INTO credits (number, target, customer_id, status, amount_cents, reason)
       VALUES ($1, $2, $3, 'requested', $4, $5) RETURNING id, created_at`,
      [creditNumber, input.target, targetInfo.customerId, input.amountCents, input.reason]
    );
    const creditId = insert.rows[0].id as number;
    const createdAt = insert.rows[0].created_at as Date;
    if (targetInfo.kind === "order") {
      await client.query("UPDATE orders SET version = version + 1 WHERE number = $1", [input.target]);
    } else {
      await client.query("UPDATE subscriptions SET version = version + 1 WHERE number = $1", [input.target]);
    }

    let outcome: "issued" | "failed";
    let killbillRef: string | null = null;
    try {
      const account = await kb.getAccountByKey(targetInfo.email);
      if (!account) throw new KillBillError(404, "account missing", false);
      const created = await kb.createCredit({
        accountId: account.accountId,
        amount: centsToKb(input.amountCents),
        currency: "CAD",
        description: `Goodwill ${creditNumber}`,
        itemType: "CREDIT_ADJ"
      }, actor.email);
      killbillRef = created[0]?.invoiceId ?? null;
      outcome = "issued";
    } catch (err) {
      if (!(err instanceof KillBillError)) throw err;
      outcome = "failed";
    }

    if (outcome === "issued") {
      await client.query("UPDATE credits SET status = 'issued', killbill_ref = $2 WHERE id = $1", [creditId, killbillRef]);
      const content = creditEmail({ creditNumber, amount: money(input.amountCents) });
      await queueNotice(client, {
        key: `credit.${creditNumber}`,
        kind: "credit",
        to: targetInfo.email,
        locale: targetInfo.locale as Locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
    } else {
      await client.query("UPDATE credits SET status = 'failed' WHERE id = $1", [creditId]);
    }
    await writeAudit(
      client, actor, "credit", input.target, input.reason, input.amountCents, killbillRef, outcome
    );
    await client.query("COMMIT");
    outbox.kick();
    if (outcome === "failed") {
      throw new ApiError(503, "billing_unavailable", creditFailedCopy(locale, creditNumber));
    }
    const record: CreditRecord = {
      number: creditNumber,
      target: input.target,
      status: outcome,
      amount_cents: input.amountCents,
      reason: input.reason,
      killbill_ref: killbillRef,
      created_at: createdAt
    };
    return record;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}

function validateCredit(locale: Locale, input: CreditInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof input.amountCents !== "number" || !Number.isInteger(input.amountCents) || input.amountCents < 100 || input.amountCents > 2500) {
    fields.amount_cents = fieldMessage("amount_cents", locale);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500 || hasControlChars(input.reason)) {
    fields.reason = fieldMessage("reason", locale);
  }
  return fields;
}

export function creditFailedCopy(locale: Locale, creditNumber: string): string {
  return locale === "fr-CA"
    ? `Kill Bill est injoignable. Le crédit ${creditNumber} est consigné comme échoué; rien n'a été ajouté.`
    : `Kill Bill is unreachable. Credit ${creditNumber} is recorded as failed; nothing was added.`;
}
