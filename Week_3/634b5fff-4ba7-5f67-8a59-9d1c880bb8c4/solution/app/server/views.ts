import { EDITION_PRICE, plateOf } from "../shared/domain.js";
import { gatewayFee } from "../shared/money.js";
import { pool } from "./db.js";
import { fail } from "./http.js";
import { invoiceView, LedgerUnreachable, transactions } from "./killbill.js";
import { requireOrder, recipientOf, type OrderRow } from "./orders.js";
import { refundsOf } from "./refunds.js";

/** Read models for the staff screens. */

export const packerOrders = async (boxState: string | null): Promise<Record<string, unknown>[]> => {
  const rows = await pool.query(
    `SELECT * FROM orders WHERE box_state IS NOT NULL AND ($1::text IS NULL OR box_state = $1) ORDER BY created_at DESC, reference`, [boxState],
  );
  return (rows.rows as OrderRow[]).map((order) => ({
    reference: order.reference,
    number: order.box_number,
    plate: plateOf(order.box_number),
    recipientName: recipientOf(order).name,
    address: { street: order.street, postcode: order.postcode, city: order.city },
    boxState: order.box_state,
    paymentState: order.payment_state,
    trackingCode: order.tracking_code,
  }));
};

export const treasurerOrders = async (): Promise<Record<string, unknown>[]> => {
  const rows = await pool.query("SELECT * FROM orders WHERE authorised_at IS NOT NULL ORDER BY created_at DESC, reference");
  return (rows.rows as OrderRow[]).map((order) => ({
    reference: order.reference,
    number: order.box_number,
    paymentState: order.payment_state,
    boxState: order.box_state ?? "available",
    grossOre: EDITION_PRICE.priceOre,
    rateBasisPoints: order.rate_basis_points,
  }));
};

interface LineRow {
  kind: "sale" | "refund";
  gross_ore: number;
  net_ore: number;
  vat_ore: number;
  charity_ore: number;
  maker_ore: number;
  posted_at: Date;
}

export const orderLedger = async (reference: string): Promise<Record<string, unknown>> => {
  const order = await requireOrder(pool, reference);
  const lines = (await pool.query("SELECT * FROM split_lines WHERE reference = $1 ORDER BY id", [reference])).rows as LineRow[];
  const totals = lines.reduce(
    (sum, line) => ({
      grossOre: sum.grossOre + line.gross_ore, netOre: sum.netOre + line.net_ore, vatOre: sum.vatOre + line.vat_ore,
      charityOre: sum.charityOre + line.charity_ore, makerOre: sum.makerOre + line.maker_ore,
    }),
    { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 },
  );
  const fee = order.paid_at && order.method ? gatewayFee(order.method, EDITION_PRICE.totalOre) : 0;
  let killbill: Record<string, unknown> | null = null;
  if (order.kb_invoice_id && order.kb_account_id) {
    try {
      const [invoice, kinds] = await Promise.all([invoiceView(order.kb_account_id, order.kb_invoice_id), transactions(reference)]);
      killbill = { invoiceId: invoice.invoiceId, items: invoice.items, transactions: kinds.map((item) => ({ type: item.type, amountOre: item.amountOre })) };
    } catch (error) {
      if (!(error instanceof LedgerUnreachable)) throw error;
    }
  }
  return {
    reference,
    rateBasisPoints: order.rate_basis_points,
    grossOre: EDITION_PRICE.priceOre,
    courierOre: EDITION_PRICE.courierOre,
    totalOre: EDITION_PRICE.totalOre,
    lines: lines.map((line) => ({
      kind: line.kind, grossOre: line.gross_ore, netOre: line.net_ore, vatOre: line.vat_ore, charityOre: line.charity_ore,
      makerOre: line.maker_ore, settledAt: line.posted_at.toISOString(),
    })),
    totals,
    gatewayFeeOre: fee,
    makerAfterFeesOre: totals.makerOre - fee,
    refunds: (await refundsOf(pool, reference)).map((refund) => ({ refundId: refund.refund_id, state: refund.state, amountOre: refund.amount_ore })),
    killbill,
  };
};

export const ratesList = async (): Promise<{ rateBasisPoints: number; effectiveFrom: string }[]> =>
  ((await pool.query("SELECT basis_points, effective_from FROM rate_changes ORDER BY effective_from, id")).rows as { basis_points: number; effective_from: Date }[])
    .map((row) => ({ rateBasisPoints: row.basis_points, effectiveFrom: row.effective_from.toISOString() }));

export const scheduleRate = async (basisPoints: unknown, effectiveFrom: unknown, now: Date): Promise<{ rateBasisPoints: number; effectiveFrom: string }> => {
  if (typeof basisPoints !== "number" || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) return fail("rate_invalid");
  const instant = typeof effectiveFrom === "string" ? new Date(effectiveFrom) : null;
  if (!instant || Number.isNaN(instant.getTime())) return fail("validation_failed");
  if (instant.getTime() <= now.getTime()) return fail("rate_must_be_future");
  await pool.query("INSERT INTO rate_changes (basis_points, effective_from) VALUES ($1, $2)", [basisPoints, instant]);
  return { rateBasisPoints: basisPoints, effectiveFrom: instant.toISOString() };
};
