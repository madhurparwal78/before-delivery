/**
 * Money moments: the cancellation quote and cancel (one fee computation for both), completion
 * close, and the charge each records, posted to Kill Bill.
 */
import type { PoolClient } from "pg";
import { toAgencyIso } from "../shared/agencyTime.js";
import { pool, transaction } from "./db.js";
import { assignmentCancelledEmail, cancellationReceiptEmail, chargesEmail } from "./emails.js";
import { ApiError, invalidTransition, validation } from "./errors.js";
import { type Context, type Reply, type Router, errorReply, ok } from "./http.js";
import { fingerprint, keyProblem, remember, replayed } from "./idempotency.js";
import { loadInvoices } from "./invoices.js";
import { postNewCharge } from "./killbill.js";
import { flushEmails, queueEmail } from "./mail.js";
import { interpreterCards, projectRequest, readable } from "./projection.js";
import { type RequestRecord, addHistory, confirmedSeats, loadRequest, lockRequest, schedulerEmails } from "./requestStore.js";
import { type Charge, centsOf, chargeFor, dollars, freeCancelUntil } from "./rules.js";

const CANCELLABLE = ["draft", "submitted", "half-staffed", "staffed"];

interface Quote {
  kind: "early" | "late";
  charge: Charge;
  freeCancelUntil: Date;
}

/** What cancelling costs right now; the quote endpoint and the cancel endpoint both use this. */
function cancellationQuote(record: RequestRecord, now: Date): Quote {
  const cutoff = freeCancelUntil(record.startsAt);
  if (record.status === "draft" || now < cutoff) {
    return { kind: "early", charge: { billableMinutes: 0, seats: 0, hourlyRateCents: record.hourlyRateCents, amountCents: 0 }, freeCancelUntil: cutoff };
  }
  return {
    kind: "late",
    charge: chargeFor(record.durationMinutes, record.hourlyRateCents, confirmedSeats(record).length),
    freeCancelUntil: cutoff,
  };
}

function quoteJson(quote: Quote): Record<string, unknown> {
  return {
    kind: quote.kind,
    fee: dollars(quote.charge.amountCents),
    free_cancel_until: toAgencyIso(quote.freeCancelUntil),
    billable_minutes: quote.charge.billableMinutes,
    seats_charged: quote.charge.seats,
    hourly_rate: dollars(quote.charge.hourlyRateCents),
  };
}

async function quote(ctx: Context) {
  const record = readable(ctx.user, await loadRequest(pool, ctx.params.id ?? ""));
  ctx.allow("client_scheduler", "coordinator");
  if (!CANCELLABLE.includes(record.status)) throw invalidTransition("This request can no longer be cancelled.");
  return ok(quoteJson(cancellationQuote(record, new Date())));
}

/** Records a charge, tries to post it at once, and returns its invoice. */
async function recordCharge(client: PoolClient, record: RequestRecord, kind: "interpreting" | "late_cancellation", charge: Charge) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO charges (request_id, kind, billable_minutes, seats, hourly_rate_cents, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [record.id, kind, charge.billableMinutes, charge.seats, charge.hourlyRateCents, charge.amountCents],
  );
  const chargeId = rows[0]?.id ?? "";
  await postNewCharge(client, chargeId);
  const [invoice] = await loadInvoices(client, "ch.id = $1", [chargeId]);
  return invoice ?? null;
}

/**
 * Runs close or cancel: not_found and role checks, then an idempotent replay or key reuse, then
 * the action. Its reply, a refusal included, is stored against a usable key in the same
 * transaction; a refusal's own changes are rolled back to the savepoint first.
 */
async function idempotent(
  ctx: Context,
  endpoint: string,
  roles: Parameters<Context["allow"]>,
  action: (client: PoolClient, record: RequestRecord, key: string | undefined) => Promise<Reply>,
): Promise<Reply> {
  const key = ctx.header("idempotency-key");
  const print = fingerprint(endpoint, ctx.params.id ?? "", ctx.rawBody);
  const reply = await transaction(async (client) => {
    const record = readable(ctx.user, await lockRequest(client, ctx.params.id ?? ""));
    ctx.allow(...roles);
    const stored = await replayed(client, ctx.user.id, key, print);
    if (stored) return stored;
    if (key === undefined || keyProblem(key) !== null) return action(client, record, key);
    await client.query("SAVEPOINT action");
    let fresh: Reply;
    try {
      fresh = await action(client, record, key);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      await client.query("ROLLBACK TO SAVEPOINT action");
      fresh = errorReply(error);
    }
    await remember(client, ctx.user.id, key, print, fresh);
    return fresh;
  });
  flushEmails();
  return reply;
}

async function cancel(ctx: Context) {
  return idempotent(ctx, "cancel", ["client_scheduler", "coordinator"], async (client, record, key) => {
    if (!CANCELLABLE.includes(record.status)) throw invalidTransition("This request can no longer be cancelled.");
    const body = ctx.json();
    const errors: Record<string, string> = {};
    const current = cancellationQuote(record, new Date());
    // A sent fee that is not the current fee, malformed or not, is a state conflict (step 7), ahead of validation.
    if (body.expected_fee !== undefined) {
      const expected = typeof body.expected_fee === "string" ? centsOf(body.expected_fee) : null;
      if (expected !== current.charge.amountCents) {
        throw new ApiError("fee_changed", "The cancellation fee has changed.", { quote: quoteJson(current) });
      }
    } else {
      errors.expected_fee = "Send the quoted fee as dollars with two decimals.";
    }
    const keyMessage = keyProblem(key);
    if (keyMessage) errors["Idempotency-Key"] = keyMessage;
    if (Object.keys(errors).length > 0) throw validation(errors);

    const confirmed = confirmedSeats(record);
    const cards = await interpreterCards(client, confirmed.flatMap((s) => (s.interpreterId ? [s.interpreterId] : [])));
    const status = current.kind === "early" ? "cancelled_early" : "cancelled_late";
    await client.query("UPDATE seats SET interpreter_id = NULL, confirmed_at = NULL WHERE request_id = $1", [record.id]);
    await client.query("UPDATE requests SET status = $2 WHERE id = $1", [record.id, status]);
    const fee = dollars(current.charge.amountCents);
    await addHistory(client, record.id, ctx.user.displayName, "cancelled", `${current.kind === "early" ? "Early" : "Late"}, fee $${fee}`);
    for (const to of await schedulerEmails(client, record.organisation.id)) {
      await queueEmail(
        client,
        cancellationReceiptEmail(to, record, current.kind, current.charge.amountCents, current.charge.billableMinutes, current.charge.seats),
      );
    }
    for (const card of cards.values()) await queueEmail(client, assignmentCancelledEmail(card.row.email, record));
    const invoice =
      current.charge.amountCents > 0 ? await recordCharge(client, record, "late_cancellation", current.charge) : null;
    const after = readable(ctx.user, await loadRequest(client, record.id));
    return ok({ request: await projectRequest(client, ctx.user, after), invoice });
  });
}

async function close(ctx: Context) {
  return idempotent(ctx, "close", ["billing_admin"], async (client, record, key) => {
    if (record.status !== "completed" || record.actualMinutes === null) {
      throw invalidTransition("Only a completed request can be closed.");
    }
    ctx.json();
    const keyMessage = keyProblem(key);
    if (keyMessage) throw validation({ "Idempotency-Key": keyMessage });
    const charge = chargeFor(record.actualMinutes, record.hourlyRateCents, confirmedSeats(record).length);
    await client.query("UPDATE requests SET status = 'invoiced' WHERE id = $1", [record.id]);
    await addHistory(
      client,
      record.id,
      ctx.user.displayName,
      "closed",
      `$${dollars(charge.amountCents)} for ${charge.billableMinutes} billable minutes × ${charge.seats} seats`,
    );
    for (const to of await schedulerEmails(client, record.organisation.id)) {
      await queueEmail(client, chargesEmail(to, record, charge));
    }
    const invoice = await recordCharge(client, record, "interpreting", charge);
    const after = readable(ctx.user, await loadRequest(client, record.id));
    return ok({ request: await projectRequest(client, ctx.user, after), invoice });
  });
}

export function registerBilling(router: Router): void {
  router.on("GET", "/api/requests/:id/cancellation-quote", quote);
  router.on("POST", "/api/requests/:id/cancel", cancel);
  router.on("POST", "/api/requests/:id/close", close);
}
