import { invalidTransition } from "../errors.js";

type ShipmentState = "placed" | "packed" | "shipped" | "delivered" | "cancelled";
type ShipmentAction = "pack" | "ship" | "deliver" | "cancel";

const SHIPMENT_MOVES: Record<ShipmentAction, { from: readonly ShipmentState[]; to: ShipmentState }> = {
  pack: { from: ["placed"], to: "packed" },
  ship: { from: ["packed"], to: "shipped" },
  deliver: { from: ["shipped"], to: "delivered" },
  cancel: { from: ["placed", "packed"], to: "cancelled" },
};

/** The one decision of every shipment state transition; every illegal move is a 409. */
export function nextShipmentState(from: ShipmentState, action: ShipmentAction): ShipmentState {
  const move = SHIPMENT_MOVES[action];
  if (!move.from.includes(from)) throw invalidTransition(from, move.to);
  return move.to;
}

type ReturnState = "requested" | "picked" | "declined";
type ReturnAction = "pickup" | "decline" | "reopen";

const RETURN_MOVES: Record<ReturnAction, { from: ReturnState; to: ReturnState }> = {
  pickup: { from: "requested", to: "picked" },
  decline: { from: "requested", to: "declined" },
  reopen: { from: "declined", to: "requested" },
};

export function nextReturnState(from: ReturnState, action: ReturnAction): ReturnState {
  const move = RETURN_MOVES[action];
  if (from !== move.from) throw invalidTransition(from, move.to);
  return move.to;
}

export type ProviderStatus = "PENDING" | "SUCCESS" | "FAILED";
type PaymentState = "awaiting_customer" | "confirmed" | "expired" | "failed";

/** UPI and net banking wait for the provider; every other method is confirmed when checkout records it. */
export function initialPaymentState(method: string | null): PaymentState {
  return method === "upi" || method === "netbanking" ? "awaiting_customer" : "confirmed";
}

/** The one decision after a provider status read: SUCCESS confirms, FAILED fails, no success by the expiry instant expires. */
export function nextPaymentState(provider: ProviderStatus, nowMs: number, expiresAtMs: number): PaymentState {
  if (provider === "SUCCESS") return "confirmed";
  if (provider === "FAILED") return "failed";
  return nowMs >= expiresAtMs ? "expired" : "awaiting_customer";
}
