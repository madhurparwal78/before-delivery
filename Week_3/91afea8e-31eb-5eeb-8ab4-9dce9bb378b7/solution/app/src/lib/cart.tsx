import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiFailure, get, post } from "./api";
import { useAuth } from "./auth";
import { DESTINATION_CHANGED } from "./pincode";
import type { GuestLine, ListingSnapshot, MergeResult, Quote } from "./types";

const GUEST_KEY = "chauraha.guestCart";
const MERGE_KEY = "chauraha.merge";
const MAX_QUANTITY = 10;

interface CartValue {
  /** The server's quote for a signed-in shopper. */
  quote: Quote | null;
  guest: GuestLine[];
  /** Units for the header badge. */
  count: number;
  loading: boolean;
  reload: () => Promise<void>;
  /** Runs a cart request and paints its quote only when no newer request has started since. */
  run: (request: () => Promise<Quote>) => Promise<Quote | null>;
  add: (item: ListingSnapshot, quantity?: number) => Promise<void>;
  setGuest: (lines: GuestLine[]) => void;
  /** After full sign-in: sends the guest cart to the merge endpoint, clears it and keeps each outcome for the cart page. */
  mergeGuest: () => Promise<void>;
  lastAdded: { item: ListingSnapshot; at: number } | null;
}

const CartContext = createContext<CartValue | null>(null);

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("CartProvider is missing");
  return value;
}

function readGuest(): GuestLine[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as GuestLine[]) : [];
  } catch {
    return [];
  }
}

export function takeMergeResults(): MergeResult[] | null {
  const raw = window.sessionStorage.getItem(MERGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as MergeResult[];
}

export function CartProvider({ children }: { children: ReactNode }): ReactNode {
  const auth = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guest, setGuestState] = useState<GuestLine[]>(readGuest);
  const [loading, setLoading] = useState(false);
  const [lastAdded, setLastAdded] = useState<CartValue["lastAdded"]>(null);
  const newest = useRef(0);
  const shopper = auth.status === "signedIn" && auth.account?.role === "shopper";

  const run = useCallback(async (request: () => Promise<Quote>): Promise<Quote | null> => {
    newest.current += 1;
    const mine = newest.current;
    const next = await request();
    if (mine !== newest.current) return null;
    setQuote(next);
    return next;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (!shopper) return;
    setLoading(true);
    try {
      await run(() => get<Quote>("/api/cart"));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    } finally {
      setLoading(false);
    }
  }, [run, shopper]);

  useEffect(() => {
    if (shopper) void reload();
    else if (auth.status === "signedOut") setQuote(null);
  }, [shopper, auth.status, reload]);

  useEffect(() => {
    window.addEventListener(DESTINATION_CHANGED, reload);
    return () => window.removeEventListener(DESTINATION_CHANGED, reload);
  }, [reload]);

  const setGuest = useCallback((lines: GuestLine[]): void => {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify(lines));
    setGuestState(lines);
  }, []);

  const add = useCallback(
    async (item: ListingSnapshot, quantity = 1): Promise<void> => {
      if (shopper) await run(() => post<Quote>("/api/cart/lines", { listing_id: item.listing_id, quantity }));
      else {
        const lines = readGuest();
        const existing = lines.find((line) => line.listing_id === item.listing_id);
        if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
        else lines.push({ ...item, quantity: Math.min(MAX_QUANTITY, quantity) });
        setGuest(lines);
      }
      setLastAdded({ item, at: Date.now() });
    },
    [run, setGuest, shopper],
  );

  const mergeGuest = useCallback(async (): Promise<void> => {
    const lines = readGuest();
    if (lines.length === 0) return;
    const result = await post<{ results: MergeResult[]; cart: Quote }>("/api/cart/merge", {
      lines: lines.slice(0, 20).map((line) => ({ listing_id: line.listing_id, quantity: line.quantity })),
    });
    window.sessionStorage.setItem(MERGE_KEY, JSON.stringify(result.results));
    setGuest([]);
    setQuote(result.cart);
  }, [setGuest]);

  const count = shopper
    ? (quote?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0)
    : guest.reduce((sum, line) => sum + line.quantity, 0);

  const value = useMemo<CartValue>(
    () => ({ quote, guest, count, loading, reload, run, add, setGuest, mergeGuest, lastAdded }),
    [quote, guest, count, loading, reload, run, add, setGuest, mergeGuest, lastAdded],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
