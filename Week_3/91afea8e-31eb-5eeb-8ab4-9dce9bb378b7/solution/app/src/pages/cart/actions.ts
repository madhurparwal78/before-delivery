import { useCallback, useMemo, useState } from "react";
import { ApiFailure, del, failureMessage, patch, post, put } from "../../lib/api";
import { useCart } from "../../lib/cart";
import type { Quote, QuoteLine } from "../../lib/types";

/** The message for the field an action failed on: the first field message the server sent, else its message. */
export function fieldMessage(error: unknown): string {
  if (error instanceof ApiFailure && error.body.errors) {
    const first = Object.values(error.body.errors)[0];
    if (first) return first;
  }
  return failureMessage(error);
}

/** A button's own pending flag and a wrapper that sets it around one request; the rest of the cart stays usable. */
export function useBusy(): [boolean, (work: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const wrap = useCallback(async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, wrap];
}

interface CartActions {
  patchLine: (lineId: string, body: Partial<Pick<QuoteLine, "quantity" | "selected" | "gift_wrap" | "gift_message">>) => Promise<Quote | null>;
  removeLine: (lineId: string) => Promise<Quote | null>;
  saveForLater: (lineId: string) => Promise<Quote | null>;
  moveToWishlist: (lineId: string) => Promise<Quote | null>;
  moveToCart: (lineId: string) => Promise<Quote | null>;
  setSpeed: (sellerId: string, speed: "standard" | "one_day") => Promise<Quote | null>;
  applyCoupon: (code: string) => Promise<Quote | null>;
  removeCoupon: () => Promise<Quote | null>;
}

/** Every cart request goes through `run`, so only the newest quote is painted. */
export function useCartActions(): CartActions {
  const { run } = useCart();
  return useMemo<CartActions>(
    () => ({
      patchLine: (lineId, body) => run(() => patch<Quote>(`/api/cart/lines/${lineId}`, body)),
      removeLine: (lineId) => run(() => del<Quote>(`/api/cart/lines/${lineId}`)),
      saveForLater: (lineId) => run(() => post<Quote>(`/api/cart/lines/${lineId}/save-for-later`, {})),
      moveToWishlist: (lineId) => run(() => post<Quote>(`/api/cart/lines/${lineId}/move-to-wishlist`, {})),
      moveToCart: (lineId) => run(() => post<Quote>(`/api/cart/saved/${lineId}/move-to-cart`, {})),
      setSpeed: (sellerId, speed) => run(() => put<Quote>("/api/cart/delivery-speed", { seller_id: sellerId, speed })),
      applyCoupon: (code) => run(() => post<Quote>("/api/cart/coupon", { code })),
      removeCoupon: () => run(() => del<Quote>("/api/cart/coupon")),
    }),
    [run],
  );
}
