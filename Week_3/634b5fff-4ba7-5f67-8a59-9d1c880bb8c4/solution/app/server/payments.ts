import type { PoolClient } from "pg";
import { EDITION_PRICE } from "../shared/domain.js";
import { alertAuthorisationExpired } from "./alerts.js";
import { moveBox } from "./boxes.js";
import { businessNow } from "./clock.js";
import { config } from "./config.js";
import { isUniqueViolation, pool, withTx } from "./db.js";
import { writeEvent } from "./events.js";
import { GatewayUnreachable, voidPayment } from "./gateway.js";
import { ApiError } from "./http.js";
import { enqueue } from "./jobs.js";
import { recordAuthorisation, recordCapture, recordClosure, recordSettlement } from "./ledger.js";
import { serial } from "./locks.js";
import { orderRate, rateAt, requireOrder, saleParts, setPaymentState, type OrderRow } from "./orders.js";
import { awaitsAuthorisation, holdsAuthorisation } from "./transitions.js";
import { applyWaitingRefunds } from "./refunds.js";
import { holdState, releaseHold } from "./valkey.js";
import { nudge } from "./shelf.js";

/** Payment lifecycle flows: claim on authorisation, void, expiry, capture, settlement and lapse. */

const orderKey = (reference: string): string => `order:${reference}`;

const holdIsLive = async (order: OrderRow): Promise<boolean> => {
  try {
    return (await holdState(order.box_number)).owner === order.hold_token;
  } catch {
    return false;
  }
};

const lostTheBox = (error: unknown): boolean =>
  isUniqueViolation(error) || (error instanceof ApiError && error.code === "illegal_transition");

/** Records a sale line at the rate locked on the order. */
const postSaleLine = async (tx: PoolClient, order: OrderRow): Promise<void> => {
  const rate = await orderRate(tx, order);
  const parts = saleParts(rate);
  await tx.query(
    `INSERT INTO split_lines (reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at)
     VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7, $8, $9)`,
    [order.reference, order.box_number, EDITION_PRICE.priceOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, rate, businessNow()],
  );
};

/** Writes the paid state and its fulfilment event in the caller's transaction. */
const markPaid = async (tx: PoolClient, order: OrderRow): Promise<void> => {
  await postSaleLine(tx, order);
  await tx.query("UPDATE orders SET paid_at = $2, certificate_state = 'pending' WHERE reference = $1", [order.reference, businessNow()]);
  await writeEvent(tx, "order.paid", order.reference, order.box_number);
};

type Claim = "claimed" | "too_late";

/** The gateway has authorised the card: the hold becomes a claim only while its Valkey key still exists. */
export const claimAuthorised = (reference: string): Promise<Claim> => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "authorised") return "claimed";
  if (!awaitsAuthorisation(order.payment_state)) return "too_late";
  if (await holdIsLive(order)) {
    try {
      await withTx(async (tx) => {
        const locked = await requireOrder(tx, reference, true);
        const now = businessNow();
        await moveBox(tx, locked.box_number, "claimed", reference);
        await setPaymentState(tx, locked, "authorised");
        await tx.query(
          "UPDATE orders SET rate_basis_points = $2, authorised_at = $3, auth_expires_at = $4, kb_closed = false WHERE reference = $1",
          [reference, await rateAt(tx, now), now, new Date(Date.now() + config.authSeconds * 1000)],
        );
        await enqueue(tx, "mail", `authorisation-${reference}`, { template: "authorisation", reference });
      });
    } catch (error) {
      if (!lostTheBox(error)) throw error;
      await markForVoid(reference);
      return "too_late";
    }
    await releaseHold(order.box_number, order.hold_token).catch(() => false);
    nudge();
    await recordAuthorisation(await requireOrder(pool, reference)).catch(() => undefined);
    return "claimed";
  }
  await markForVoid(reference);
  return "too_late";
});

const markForVoid = async (reference: string): Promise<void> => {
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (awaitsAuthorisation(locked.payment_state)) await setPaymentState(tx, locked, "authorised");
    await tx.query("UPDATE orders SET void_pending = true WHERE reference = $1", [reference]);
  });
  await voidAtGateway(reference);
};

const voidAtGateway = async (reference: string): Promise<void> => {
  const order = await requireOrder(pool, reference);
  if (!order.void_pending || order.payment_state !== "authorised" || !order.payment_id) return;
  try {
    await voidPayment(order.payment_id, `void-${reference}`);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return;
    throw error;
  }
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    await setPaymentState(tx, locked, "voided");
    await tx.query("UPDATE orders SET void_pending = false, kb_closed = true WHERE reference = $1", [reference]);
  });
};

/** Voids an authorisation that landed after its hold ended; repeated by the sweep while the gateway is away. */
export const attemptVoid = (reference: string): Promise<void> => serial(orderKey(reference), () => voidAtGateway(reference));

/** An uncaptured authorisation reached its edge: void it, release the box, alert the maker. */
export const expireAuthorisation = (reference: string): Promise<void> => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (!holdsAuthorisation(order.payment_state) || !order.payment_id) return;
  try {
    await voidPayment(order.payment_id, `expire-${reference}`);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return;
    throw error;
  }
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    await setPaymentState(tx, locked, "authorisation_expired");
    await moveBox(tx, locked.box_number, "available");
    await tx.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [reference]);
    await alertAuthorisationExpired(tx, `expired-${reference}`, locked.box_number, EDITION_PRICE.totalOre);
  });
  await recordClosure(await requireOrder(pool, reference)).catch(() => undefined);
});

export const closeLedger = (reference: string): Promise<void> => serial(orderKey(reference), async () => {
  await recordClosure(await requireOrder(pool, reference));
});

export const resumeAuthorisationRecord = (reference: string): Promise<void> => serial(orderKey(reference), async () => {
  await recordAuthorisation(await requireOrder(pool, reference));
});

/** The gateway confirmed the capture: pay out once Kill Bill has it too. Returns whether the order is now captured. */
export const finishCapture = (reference: string): Promise<boolean> => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "captured") return true;
  if (!order.capture_confirmed || !holdsAuthorisation(order.payment_state)) return false;
  await recordCapture(order);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (!holdsAuthorisation(locked.payment_state)) return;
    await setPaymentState(tx, locked, "captured");
    await moveBox(tx, locked.box_number, "packed");
    await markPaid(tx, locked);
    await writeEvent(tx, "box.packed", reference, locked.box_number);
  });
  await applyWaitingRefunds(reference);
  return true;
});

/** The transfer arrived in full and in time: settle once Kill Bill has the purchase. */
export const finishSettlement = (reference: string): Promise<boolean> => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "settled") return true;
  if (!order.settle_confirmed || order.payment_state !== "pending") return false;
  await recordSettlement(order);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (locked.payment_state !== "pending") return;
    await setPaymentState(tx, locked, "settled");
    await moveBox(tx, locked.box_number, "claimed");
    await markPaid(tx, locked);
  });
  await applyWaitingRefunds(reference);
  return true;
});

/** A pending transfer passed its deadline: the box goes back on sale and the buyer is told. */
export const lapseTransfer = (reference: string): Promise<void> => serial(orderKey(reference), async () => {
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (locked.payment_state !== "pending") return;
    await setPaymentState(tx, locked, "lapsed");
    await moveBox(tx, locked.box_number, "available");
    await enqueue(tx, "mail", `lapse-${reference}`, { template: "lapse", reference });
  });
});

export const markPackedBankOrder = async (tx: PoolClient, order: OrderRow): Promise<void> => {
  await moveBox(tx, order.box_number, "packed");
  await writeEvent(tx, "box.packed", order.reference, order.box_number);
};
