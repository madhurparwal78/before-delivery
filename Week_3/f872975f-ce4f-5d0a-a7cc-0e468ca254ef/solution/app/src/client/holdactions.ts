// Pay and cut, and Cancel hold: the requests and the outcome copy shared by the board and account pages.
import { useState } from "react";
import type { Hold, SaleResult } from "../shared/api";
import { api, refreshServices } from "./api";

export const HOLD_COPY = {
  released: "Hold released. Deposit refunded.",
  notActive: "This hold is no longer active.",
  cancelOffline: "Billing is offline. Your hold is unchanged.",
  payOffline: "Billing is offline. Your hold is safe and nothing was charged.",
  storageDown: "Cut tickets can't be saved right now. Your hold is safe and nothing was charged.",
  paymentFailed: "Billing did not confirm the payment. You were not charged.",
  expired: "Hold expired. The deposit was kept.",
  paused: "Paused while billing is offline.",
  generic: "Something went wrong. Try again.",
} as const;

type Outcome =
  | { kind: "cancelled"; hold: Hold; message: string }
  | { kind: "paid"; sale: SaleResult; message: string }
  | { kind: "not_active"; message: string }
  | { kind: "unauthenticated"; message: string }
  | { kind: "failed"; message: string };

/** A fresh Idempotency-Key (getRandomValues works on plain-http origins too). */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useHoldActions() {
  const [pending, setPending] = useState<{ id: string; action: "pay" | "cancel" } | null>(null);

  const cancel = async (hold: Hold): Promise<Outcome> => {
    setPending({ id: hold.id, action: "cancel" });
    const r = await api<{ hold: Hold }>("POST", `/api/holds/${hold.id}/cancel`, {});
    setPending(null);
    if (r.ok) return { kind: "cancelled", hold: r.data.hold, message: HOLD_COPY.released };
    if (r.error.error === "hold_not_active") return { kind: "not_active", message: HOLD_COPY.notActive };
    if (r.error.error === "unauthenticated") return { kind: "unauthenticated", message: "" };
    if (r.error.error === "billing_unavailable") {
      void refreshServices();
      return { kind: "failed", message: HOLD_COPY.cancelOffline };
    }
    return { kind: "failed", message: HOLD_COPY.generic };
  };

  const pay = async (hold: Hold): Promise<Outcome> => {
    setPending({ id: hold.id, action: "pay" });
    const r = await api<{ sale: SaleResult }>("POST", `/api/holds/${hold.id}/purchase`, {}, { "Idempotency-Key": newKey() });
    setPending(null);
    if (r.ok) return { kind: "paid", sale: r.data.sale, message: `Paid. Cut ticket ${r.data.sale.ticket} is with the saw.` };
    switch (r.error.error) {
      case "hold_not_active": return { kind: "not_active", message: HOLD_COPY.notActive };
      case "unauthenticated": return { kind: "unauthenticated", message: "" };
      case "storage_unavailable": return { kind: "failed", message: HOLD_COPY.storageDown };
      case "payment_failed": return { kind: "failed", message: HOLD_COPY.paymentFailed };
      case "billing_unavailable":
        void refreshServices();
        return { kind: "failed", message: HOLD_COPY.payOffline };
      default: return { kind: "failed", message: HOLD_COPY.generic };
    }
  };

  return { pending, cancel, pay };
}
