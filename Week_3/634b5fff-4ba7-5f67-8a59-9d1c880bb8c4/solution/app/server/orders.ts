import { EDITION_PRICE, plateOf, type BoxState, type PaymentState } from "../shared/domain.js";
import { splitSale, type SplitParts } from "../shared/money.js";
import { businessNow, formatCopenhagen } from "./clock.js";
import type { Queryable } from "./db.js";
import { fail } from "./http.js";
import { canMovePayment } from "./transitions.js";

export interface OrderRow {
  reference: string;
  box_number: number;
  hold_token: string;
  order_token: string;
  method: "card" | "bank" | null;
  buyer_name: string | null;
  buyer_email: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  gift_name: string | null;
  gift_email: string | null;
  gift_message: string | null;
  payment_state: PaymentState;
  box_state: BoxState | null;
  live: boolean;
  rate_basis_points: number | null;
  payment_id: string | null;
  transfer_id: string | null;
  transfer_iban: string | null;
  transfer_reference: string | null;
  challenge_id: string | null;
  challenge_expires_at: Date | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  deadline_at: Date | null;
  authorised_at: Date | null;
  auth_expires_at: Date | null;
  capture_requested: boolean;
  capture_confirmed: boolean;
  capture_attempts: number;
  settle_confirmed: boolean;
  void_pending: boolean;
  kb_closed: boolean;
  last_sequence: number;
  certificate_state: "none" | "pending" | "issued" | "cancelled";
  tracking_code: string | null;
  paid_at: Date | null;
  created_at: Date;
}

export const loadOrder = async (q: Queryable, reference: string, lock = false): Promise<OrderRow | null> => {
  const found = await q.query(`SELECT * FROM orders WHERE reference = $1${lock ? " FOR UPDATE" : ""}`, [reference]);
  return (found.rows[0] as OrderRow | undefined) ?? null;
};

export const requireOrder = async (q: Queryable, reference: string, lock = false): Promise<OrderRow> =>
  (await loadOrder(q, reference, lock)) ?? fail("not_found");

/** The charity rate in force at an instant, in basis points. */
export const rateAt = async (q: Queryable, instant: Date): Promise<number> => {
  const found = await q.query(
    "SELECT basis_points FROM rate_changes WHERE effective_from <= $1 ORDER BY effective_from DESC, id DESC LIMIT 1", [instant],
  );
  return found.rows[0].basis_points as number;
};

/** The split of one box at a rate. */
export const saleParts = (rateBasisPoints: number): SplitParts => splitSale(EDITION_PRICE.netOre, EDITION_PRICE.vatOre, rateBasisPoints);

/** The rate an order is held to: locked at authorisation, otherwise the rate in force now. */
export const orderRate = async (q: Queryable, order: OrderRow): Promise<number> =>
  order.rate_basis_points ?? (await rateAt(q, businessNow()));

export const recipientOf = (order: OrderRow): { name: string; email: string } => ({
  name: order.gift_name ?? order.buyer_name ?? "",
  email: order.gift_email ?? order.buyer_email ?? "",
});

export const setPaymentState = async (tx: Queryable, order: OrderRow, to: PaymentState): Promise<void> => {
  if (!canMovePayment(order.payment_state, to)) fail("illegal_transition");
  await tx.query("UPDATE orders SET payment_state = $2 WHERE reference = $1", [order.reference, to]);
  order.payment_state = to;
};

interface TransferView {
  iban: string;
  paymentReference: string;
  amountOre: number;
  deadlineAt: string;
}

export const transferView = (order: OrderRow): TransferView | null =>
  order.method === "bank" && order.transfer_iban && order.deadline_at
    ? {
        iban: order.transfer_iban,
        paymentReference: order.transfer_reference ?? order.reference,
        amountOre: EDITION_PRICE.totalOre,
        deadlineAt: formatCopenhagen(order.deadline_at),
      }
    : null;

export const orderView = async (q: Queryable, order: OrderRow): Promise<Record<string, unknown>> => ({
  reference: order.reference,
  number: order.box_number,
  plate: plateOf(order.box_number),
  method: order.method,
  paymentState: order.payment_state,
  boxState: order.box_state ?? "held",
  totalOre: EDITION_PRICE.totalOre,
  charityOre: saleParts(await orderRate(q, order)).charityOre,
  transfer: transferView(order),
  certificate: { state: order.certificate_state },
});
