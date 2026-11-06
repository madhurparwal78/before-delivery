import type { Response } from "express";
import { one, rows, withTransaction } from "../db.ts";
import { ApiError } from "../errors.ts";
import {
  loadOrderContext, orchardPayableCents, grossesByBeekeeper, audit, type OrderContext, type SettlementRow,
} from "../store.ts";
import { allocateSettlement } from "../domain/model.ts";
import { isValidDate, pacificDateParts } from "../domain/dates.ts";
import { serializeSettlement } from "./serialize.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, requireSession, param } from "../context.ts";
import { idempotent, idempotencyKeyOf } from "./idempotency.ts";

/** The fixed allocation stored when a settle request is accepted. */
export function allocationFor(context: OrderContext): {
  payable_cents: number;
  commission_cents: number;
  shares: { beekeeper_id: string; hives: number; gross_cents: number; payout_cents: number }[];
} {
  const grosses = grossesByBeekeeper(context);
  const payable = orchardPayableCents(context);
  const allocation = allocateSettlement(
    payable,
    context.ruleSet.commission_bps,
    [...grosses.entries()].map(([beekeeperId, g]) => ({ beekeeperId, hives: g.hives, grossCents: g.grossCents })),
  );
  return {
    payable_cents: payable,
    commission_cents: allocation.commissionCents,
    shares: allocation.shares.map((share) => ({
      beekeeper_id: share.beekeeperId,
      hives: share.hives,
      gross_cents: share.grossCents,
      payout_cents: share.payoutCents,
    })),
  };
}

async function beekeeperNames(services: AppServices): Promise<Map<string, string>> {
  const beekeepers = await rows<{ id: string; business: string | null; name: string }>(
    services.pool,
    "SELECT id, business, name FROM users WHERE role = 'beekeeper'",
  );
  return new Map(beekeepers.map((b) => [b.id, b.business ?? b.name]));
}

/** GET /api/orders/{id}/settlement — the settlement split, preview or recorded. */
export async function settlementPreview(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  res.status(200).json(serializeSettlement(context, await beekeeperNames(services)));
}

/** POST /api/orders/{id}/settle — records the grower payment and settles. */
export async function settleOrder(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  if (actor.role !== "broker") throw ApiError.notFound();
  const context = await loadOrderContext(services.pool, param(req, "id"));
  if (!context) throw ApiError.notFound();
  const order = context.order;
  const key = idempotencyKeyOf(req);
  const body = bodyOf(req);
  const bodyText = JSON.stringify(body);

  const result = await idempotent(services.pool, "settle", order.id, key, bodyText, async () => {
    if (order.status === "settled" || (order.status === "inspected" && order.settlement_status !== "none")) {
      throw new ApiError(409, "already_settled", `${context.orchard.name} is already settled.`);
    }
    if (order.status !== "inspected") {
      throw ApiError.invalidTransition(order.ref, order.status);
    }
    if (context.drops.some((d) => d.status !== "accepted")) {
      throw new ApiError(409, "drops_not_accepted", `Every drop must be accepted before ${context.orchard.name} can be settled.`);
    }
    const fields: Record<string, string> = {};
    const paymentReceivedOn = typeof body.payment_received_on === "string" ? body.payment_received_on : "";
    if (!isValidDate(paymentReceivedOn)) {
      fields.payment_received_on = "Use a date like 2027-02-05";
    } else if (paymentReceivedOn > pacificDateParts(new Date())) {
      fields.payment_received_on = "Payment date can't be after today (Pacific)";
    }
    if (!key || key.length < 1 || key.length > 100) {
      fields["Idempotency-Key"] = "Idempotency-Key must be 1 to 100 characters";
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

    const allocation = allocationFor(context);
    await withTransaction(services.pool, async (client) => {
      const updated = await client.query(
        `UPDATE orders SET settlement_status = 'queued'
         WHERE id = $1 AND status = 'inspected' AND settlement_status = 'none'`,
        [order.id],
      );
      if (updated.rowCount === 0) {
        throw new ApiError(409, "already_settled", `${context.orchard.name} is already settled.`);
      }
      await client.query(
        `INSERT INTO settlements (order_id, status, payment_received_on, payable_cents, commission_bps, commission_cents, shares, kb_payment_external_key)
         VALUES ($1,'queued',$2,$3,$4,$5,$6,$7)
         ON CONFLICT (order_id) DO NOTHING`,
        [order.id, paymentReceivedOn, allocation.payable_cents, context.ruleSet.commission_bps,
          allocation.commission_cents, JSON.stringify(allocation.shares), `settle-${order.id}`],
      );
      await audit(client, "settlement", order.id, "queued", actor.id);
    });

    const completed = await recordSettlementPayment(services, order.id);
    const fresh = await loadOrderContext(services.pool, order.id);
    if (!fresh) throw ApiError.notFound();
    const settlement = serializeSettlement(fresh, await beekeeperNames(services));
    return completed
      ? { status: 200, body: { status: "settled", settlement } }
      : { status: 202, body: { status: "queued", settlement } };
  });
  res.status(result.status).json(result.body);
}

/**
 * Tries to record a queued settlement's payment. Returns true when the
 * settlement is settled (now or previously). The lease is released at once
 * when the payment attempt fails, so the next tick can retry quickly.
 */
export async function recordSettlementPayment(services: AppServices, orderId: string): Promise<boolean> {
  const claimed = await services.pool.query(
    `UPDATE settlements SET lease_until = now() + interval '30 seconds', lease_owner = $2
     WHERE order_id = $1 AND status = 'queued'
       AND (lease_until IS NULL OR lease_until < now())
     RETURNING *`,
    [orderId, `settle-${process.pid}`],
  );
  const row = claimed.rows[0] as SettlementRow | undefined;
  if (!row) {
    const existing = await one<SettlementRow>(services.pool, "SELECT * FROM settlements WHERE order_id = $1", [orderId]);
    return existing?.status === "settled";
  }
  const context = await loadOrderContext(services.pool, orderId);
  if (!context) return false;
  const payable = row.payable_cents;
  let recorded = false;
  if (payable === 0) {
    recorded = true;
  } else if (context.order.kb_account_id && context.order.kb_balance_invoice_id) {
    try {
      await services.killbill.recordPayment(
        context.order.kb_account_id,
        context.order.kb_balance_invoice_id,
        payable,
        row.kb_payment_external_key ?? `settle-${orderId}`,
      );
      recorded = true;
    } catch (error) {
      console.error("settlement payment attempt failed", orderId, error instanceof Error ? error.message : error);
      recorded = false;
    }
  }
  if (!recorded) {
    await services.pool.query("UPDATE settlements SET lease_until = now() - interval '1 second' WHERE order_id = $1", [orderId]);
    return false;
  }
  await withTransaction(services.pool, async (client) => {
    await client.query(
      "UPDATE settlements SET status = 'settled', settled_at = now(), lease_until = NULL WHERE order_id = $1 AND status = 'queued'",
      [orderId],
    );
    await client.query("UPDATE orders SET status = 'settled', settlement_status = 'settled' WHERE id = $1", [orderId]);
    await audit(client, "settlement", orderId, "settled", "worker");
  });
  return true;
}

/** Retries every queued settlement; every instance runs this every 10 seconds. */
export async function retryQueuedSettlements(services: AppServices): Promise<void> {
  const pending = await rows<{ order_id: string }>(
    services.pool,
    "SELECT order_id FROM settlements WHERE status = 'queued'",
  );
  for (const entry of pending) {
    await recordSettlementPayment(services, entry.order_id).catch(() => undefined);
  }
}
