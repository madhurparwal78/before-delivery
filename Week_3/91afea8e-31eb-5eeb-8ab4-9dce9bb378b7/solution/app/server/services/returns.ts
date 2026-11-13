import type { PoolClient } from "pg";
import { promiseText } from "../../shared/format.js";
import { one, query, transaction } from "../db.js";
import { addDays, todayInIndia } from "../domain/promise.js";
import { proratedRefund } from "../domain/refund.js";
import { nextReturnState } from "../domain/state.js";
import { detach } from "../background.js";
import { ApiError, FIELD, invalidTransition, notFound, validationFailed } from "../errors.js";
import { publicId } from "../id.js";
import { settleRefund } from "./ledger.js";
import { createRefund, type CreatedRefund } from "./refunds.js";
import { postReturn } from "./settlement.js";
import { lineAccounting } from "./views.js";

interface ReturnRecord {
  id: string;
  shipment_line_id: string;
  quantity: number;
  reason: string;
  state: "requested" | "picked" | "declined";
  decline_reason: string | null;
  refund_paise: number | null;
  shipment_id: string;
  seller_id: string;
  account_id: string;
  order_id: string;
  title: string;
}

const RETURN_SELECT = `SELECT r.*, sl.shipment_id, sl.title, s.seller_id, s.order_id, o.account_id
  FROM returns r JOIN shipment_lines sl ON sl.id = r.shipment_line_id JOIN shipments s ON s.id = sl.shipment_id JOIN orders o ON o.id = s.order_id`;

export async function loadReturn(id: string, client?: PoolClient): Promise<ReturnRecord> {
  const found = await one<ReturnRecord & Record<string, unknown>>(`${RETURN_SELECT} WHERE r.id = $1`, [id], client);
  if (!found) throw notFound();
  return found;
}

export async function returnView(record: ReturnRecord): Promise<Record<string, unknown>> {
  const legs = await query<{ method: string; amount_paise: number; status: string }>(
    `SELECT pl.method, rl.amount_paise, rl.status FROM refunds f JOIN refund_legs rl ON rl.refund_id = f.id JOIN payment_legs pl ON pl.id = rl.leg_id
      WHERE f.return_id = $1 ORDER BY rl.id`,
    [record.id],
  );
  return {
    return_id: record.id,
    state: record.state,
    quantity: record.quantity,
    refund_paise: record.refund_paise ?? 0,
    refund_legs: legs.map((leg) => ({ method: leg.method, amount_paise: leg.amount_paise, status: leg.status })),
    decline_reason: record.decline_reason,
    shipment_id: record.shipment_id,
    line_id: record.shipment_line_id,
    title: record.title,
    reason: record.reason,
  };
}

interface LineFacts {
  id: string;
  shipment_id: string;
  order_id: string;
  state: string;
  delivered_on: string | null;
  return_days: number;
  account_id: string;
  seller_id: string;
}

export async function lineFacts(lineId: string, client?: PoolClient): Promise<LineFacts> {
  const found = await one<LineFacts & Record<string, unknown>>(
    `SELECT sl.id, sl.shipment_id, s.order_id, s.state, s.delivered_on, c.return_days, o.account_id, s.seller_id
       FROM shipment_lines sl JOIN shipments s ON s.id = sl.shipment_id JOIN orders o ON o.id = s.order_id JOIN categories c ON c.slug = sl.category
      WHERE sl.id = $1`,
    [lineId],
    client,
  );
  if (!found) throw notFound();
  return found;
}

/** A shopper's return request: within the server's eligibility window, never beyond the units left. */
export async function requestReturn(accountId: string, raw: Record<string, unknown>, nowMs: number): Promise<Record<string, unknown>> {
  const lineId = typeof raw.shipment_line_id === "string" ? raw.shipment_line_id : "";
  const facts = await lineFacts(lineId);
  if (facts.account_id !== accountId) throw notFound();
  const quantity = typeof raw.quantity === "number" && Number.isInteger(raw.quantity) && raw.quantity >= 1 ? raw.quantity : null;
  const reason = typeof raw.reason === "string" ? raw.reason : "";
  const errors: Record<string, string> = {};
  if (quantity === null) errors.quantity = FIELD.needsWholeNumber;
  if ([...reason].length > 500) errors.reason = FIELD.nameLength("Reason", 0, 500, [...reason].length);
  for (const key of Object.keys(raw)) if (!["shipment_line_id", "quantity", "reason"].includes(key)) errors[key] = FIELD.cantSet;
  if (facts.state !== "delivered") throw invalidTransition(facts.state, "requested");
  if (facts.return_days === 0) throw new ApiError(409, "not_returnable");
  const until = addDays(facts.delivered_on as string, facts.return_days);
  if (todayInIndia(nowMs) > until) throw new ApiError(409, "return_window_closed", { date: promiseText(until) });
  const accounting = await lineAccounting(lineId);
  const open = accounting.quantity - accounting.settledUnits - accounting.reservedUnits;
  if (quantity !== null && quantity > open) errors.quantity = FIELD.refundUnits(Math.max(open, 0));
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const id = publicId("RT");
  await query("INSERT INTO returns (id, shipment_line_id, quantity, reason, state, created_at) VALUES ($1, $2, $3, $4, 'requested', $5)", [
    id, lineId, quantity, reason, nowMs,
  ]);
  const estimate = proratedRefund(accounting.lineTotalPaise, accounting.quantity, accounting.settledUnits, accounting.refundedPaise, quantity as number);
  return { return_id: id, state: "requested", quantity, refund_estimate_paise: estimate };
}

/** Starts the refund at once: the line's prorated share goes back through the refund routing. */
export async function pickUp(id: string, nowMs: number): Promise<ReturnRecord> {
  const refundId = await transaction(async (client) => {
    const record = await loadReturn(id, client);
    const next = nextReturnState(record.state, "pickup");
    const accounting = await lineAccounting(record.shipment_line_id, client);
    const amount = proratedRefund(accounting.lineTotalPaise, accounting.quantity, accounting.settledUnits, accounting.refundedPaise, record.quantity);
    const created = await createRefund(
      { orderId: record.order_id, shipmentId: record.shipment_id, lineId: record.shipment_line_id, returnId: record.id, source: "return", quantity: record.quantity, amountPaise: amount },
      client,
    );
    await client.query("UPDATE returns SET state = $2, refund_paise = $3 WHERE id = $1", [id, next, amount]);
    await postReturn(record.shipment_line_id, record.quantity, accounting.settledUnits, nowMs, client);
    return created.refundId;
  });
  detach(settleRefund(refundId));
  return loadReturn(id);
}

export async function decline(id: string, reason: string): Promise<ReturnRecord> {
  const record = await loadReturn(id);
  const next = nextReturnState(record.state, "decline");
  await query("UPDATE returns SET state = $2, decline_reason = $3 WHERE id = $1", [id, next, reason]);
  return loadReturn(id);
}

export async function reopen(id: string): Promise<ReturnRecord> {
  const record = await loadReturn(id);
  const next = nextReturnState(record.state, "reopen");
  await query("UPDATE returns SET state = $2, decline_reason = NULL WHERE id = $1", [id, next]);
  return loadReturn(id);
}

/** A support refund of a delivered line; a line with an open return can only be refunded through that return. */
export async function supportRefund(lineId: string, quantity: number, nowMs: number): Promise<CreatedRefund & { amountPaise: number }> {
  const result = await transaction(async (client) => {
    const facts = await lineFacts(lineId, client);
    if (facts.state !== "delivered") throw invalidTransition(facts.state, "refunded");
    const accounting = await lineAccounting(lineId, client);
    if (accounting.reservedUnits > 0) throw invalidTransition("return requested", "refunded");
    const open = accounting.quantity - accounting.settledUnits;
    if (quantity > open) throw validationFailed({ quantity: FIELD.refundUnits(open) });
    const amount = proratedRefund(accounting.lineTotalPaise, accounting.quantity, accounting.settledUnits, accounting.refundedPaise, quantity);
    const created = await createRefund(
      { orderId: facts.order_id, shipmentId: facts.shipment_id, lineId, returnId: null, source: "support", quantity, amountPaise: amount },
      client,
    );
    await postReturn(lineId, quantity, accounting.settledUnits, nowMs, client);
    return { ...created, amountPaise: amount };
  });
  detach(settleRefund(result.refundId));
  return result;
}
