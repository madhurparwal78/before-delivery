import { useCallback, useRef, useState } from "react";
import { api } from "./lib/api";
import { formatEuro } from "./lib/format";
import { useLatestRequest } from "./lib/hooks";
import type { Cart } from "./types";

export const CART_ERROR = "Something went wrong. Try again.";

export function cartTotalCopy(cents: number): string {
  return `Cart total ${formatEuro(cents)}.`;
}

/**
 * The cart as the server last answered. A change shows only once the server answers, and when several
 * are in flight only the latest answer is applied.
 */
export function useCart(announce: (text: string) => void) {
  const [cart, setCart] = useState<Cart | null>(null);
  const latest = useRef<Cart | null>(null);
  const changes = useLatestRequest();

  const apply = useCallback((next: Cart) => {
    latest.current = next;
    setCart(next);
  }, []);

  const refresh = useCallback(() => {
    api<Cart>("GET", "/api/cart").then((answer) => {
      latest.current = answer;
      setCart(answer);
    }, () => undefined);
  }, []);

  /** Sends one cart change; resolves true when its answer was applied. */
  const change = useCallback(async (send: () => Promise<Cart>, announceTotal = true): Promise<boolean> => {
    const token = changes.begin();
    try {
      const answer = await send();
      if (!changes.isLatest(token)) return false;
      apply(answer);
      if (announceTotal) announce(answer.lines.length === 0 ? "Your cart is empty." : cartTotalCopy(answer.total_cents));
      return true;
    } catch {
      if (changes.isLatest(token)) announce(CART_ERROR);
      return false;
    }
  }, [announce, apply, changes]);

  return { cart, latest, apply, refresh, change };
}
