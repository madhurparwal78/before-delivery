import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiFailure } from "../lib/api";
import { useLocation } from "../lib/router";
import type { Cart, Flavour, Quote, User } from "../lib/types";
import { money, PROVINCE_NAMES } from "../../shared/format";

// The storefront's shared state: who is signed in, the flavours with live stock, the crate and
// the server's quote for it. Every figure shown comes from the server.

export interface LiveReview {
  flavour: string;
  review: { id: string; rating: number; body: string; author_first_name: string; created_at: string };
}

interface Shop {
  user: User | null | undefined;
  userOutage: boolean;
  refreshUser: () => Promise<void>;
  flavours: Flavour[] | null;
  stockUnavailable: boolean;
  liveDown: boolean;
  /** Counts each time the live stream opens, so a page can catch up on what it may have missed. */
  liveOpened: number;
  setStock: (slug: string, stockLeft: number) => void;
  soldOut: Set<string>;
  markSoldOut: (slug: string, soldOut: boolean) => void;
  cart: Cart | null;
  cartOutage: boolean;
  clockOffset: number;
  setCart: (cart: Cart) => void;
  refreshCart: () => Promise<Cart | null>;
  quote: Quote | null;
  quoteStale: boolean;
  requote: (cart: Cart) => Promise<Quote | null>;
  updateCart: (changes: { province?: string; subscribe?: boolean; cadence?: Cart["cadence"] }) => Promise<void>;
  crateMessage: string;
  announceCrate: (text: string) => void;
  totalMessage: string;
  onReview: (listener: (event: LiveReview) => void) => () => void;
  /** Pages that show live stock or reviews hold the live feed open while they are mounted. */
  watchLive: () => () => void;
}

const ShopContext = createContext<Shop | null>(null);

export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error("useShop outside ShopProvider");
  return shop;
}

export const HOLD_ENDED = "Your hold ended and the cans went back on the shelf.";

export const flavourName = (flavours: Flavour[] | null, slug: string): string => flavours?.find((f) => f.slug === slug)?.name ?? slug;

/** The shipping phrase, built from the server's free-shipping figures. */
export function shippingPhrase(quote: Quote): string {
  const province = PROVINCE_NAMES[quote.province] ?? quote.province;
  return quote.free_shipping.remaining_cents === 0
    ? `Free shipping unlocked in ${province}.`
    : `${money(quote.free_shipping.remaining_cents)} to free shipping in ${province}.`;
}

export function cansOf(cart: Cart): { flavour: string; quantity: number }[] {
  const tally = new Map<string, number>();
  for (const slot of cart.slots) if (slot) tally.set(slot.flavour, (tally.get(slot.flavour) ?? 0) + 1);
  return [...tally].map(([flavour, quantity]) => ({ flavour, quantity }));
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [userOutage, setUserOutage] = useState(false);
  const [flavours, setFlavours] = useState<Flavour[] | null>(null);
  const [stockUnavailable, setStockUnavailable] = useState(false);
  const [liveDown, setLiveDown] = useState(false);
  const [liveOpened, setLiveOpened] = useState(0);
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const [cart, setCartState] = useState<Cart | null>(null);
  const [cartOutage, setCartOutage] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [crateMessage, setCrateMessage] = useState("");
  const [totalMessage, setTotalMessage] = useState("");
  const reviewListeners = useRef(new Set<(event: LiveReview) => void>());
  const [watchers, setWatchers] = useState(0);
  const watchLive = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);
  const live = watchers > 0;
  const quoteSeq = useRef(0);

  const refreshUser = useCallback(async () => {
    try {
      setUser((await api<{ user: User }>("GET", "/api/me")).user);
      setUserOutage(false);
    } catch (error) {
      setUser(null);
      setUserOutage(error instanceof ApiFailure && error.status === 503);
    }
  }, []);

  const setCart = useCallback((next: Cart) => {
    setCartState((previous) => {
      if (previous?.hold.status === "active" && next.hold.status === "expired") setCrateMessage(HOLD_ENDED);
      return next;
    });
    setClockOffset(Date.parse(next.server_time) - Date.now());
    setCartOutage(false);
  }, []);

  const requote = useCallback(async (basis: Cart): Promise<Quote | null> => {
    const seq = ++quoteSeq.current;
    try {
      const fresh = await api<Quote>("POST", "/api/quote", { province: basis.province, subscribe: basis.subscribe, cans: cansOf(basis) });
      if (seq === quoteSeq.current) {
        setQuote(fresh);
        setQuoteStale(false);
      }
      return fresh;
    } catch {
      if (seq === quoteSeq.current) setQuoteStale(true);
      return null;
    }
  }, []);

  const refreshCart = useCallback(async (): Promise<Cart | null> => {
    try {
      const fresh = (await api<{ cart: Cart }>("GET", "/api/cart")).cart;
      setCart(fresh);
      void requote(fresh);
      return fresh;
    } catch {
      setCartOutage(true);
      setQuoteStale(true);
      return null;
    }
  }, [requote, setCart]);

  const updateCart = useCallback(
    async (changes: { province?: string; subscribe?: boolean; cadence?: Cart["cadence"] }) => {
      try {
        const fresh = (await api<{ cart: Cart }>("PATCH", "/api/cart", changes)).cart;
        setCart(fresh);
        const priced = await requote(fresh);
        if (!priced) throw new Error("quote failed");
        if (changes.province !== undefined || changes.subscribe !== undefined) {
          setTotalMessage(`Total ${money(priced.total_cents)} with shipping to ${PROVINCE_NAMES[priced.province] ?? priced.province}.`);
        }
      } catch {
        setQuoteStale(true);
        setTotalMessage("Totals can't be calculated right now. Try again in a moment.");
      }
    },
    [requote, setCart],
  );

  const setStock = useCallback((slug: string, stockLeft: number) => {
    setFlavours((list) => list?.map((f) => (f.slug === slug ? { ...f, stock_left: stockLeft } : f)) ?? list);
  }, []);

  const markSoldOut = useCallback((slug: string, isSoldOut: boolean) => {
    setSoldOut((set) => {
      if (set.has(slug) === isSoldOut) return set;
      const next = new Set(set);
      if (isSoldOut) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);

  // Only pages that depend on who is signed in ask; the home, box and stockist pages don't.
  const { path } = useLocation();
  const needsUser = !/^\/($|box$|stockists|sign-in$|sign-up$)/.test(path);
  useEffect(() => {
    if (needsUser && user === undefined) void refreshUser();
  }, [needsUser, user, refreshUser]);

  useEffect(() => {
    void refreshCart();
    api<{ flavours: Flavour[] }>("GET", "/api/flavours")
      .then((body) => {
        setFlavours(body.flavours);
        setStockUnavailable(false);
      })
      .catch(() => setStockUnavailable(true));
  }, [refreshCart]);

  useEffect(() => {
    if (!live) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      source = new EventSource("/api/live");
      source.onopen = () => {
        setLiveDown(false);
        setLiveOpened((n) => n + 1);
        // The server recycles each stream, so catch up on anything that changed while it was reconnecting.
        void api<{ flavours: Flavour[] }>("GET", "/api/flavours")
          .then(({ flavours }) => {
            for (const f of flavours) {
              setStock(f.slug, f.stock_left);
              if (f.stock_left > 0) markSoldOut(f.slug, false);
            }
          })
          .catch(() => undefined);
      };
      source.addEventListener("stock", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { flavour: string; stock_left: number };
        setStock(data.flavour, data.stock_left);
        if (data.stock_left > 0) markSoldOut(data.flavour, false);
      });
      source.addEventListener("review", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as LiveReview;
        for (const listener of reviewListeners.current) listener(data);
      });
      source.onerror = () => {
        // A recycled stream reconnects by itself (CONNECTING); only a refused one (CLOSED) means live stock is down.
        if (source?.readyState !== EventSource.CLOSED) return;
        setLiveDown(true);
        source.close();
        retry = setTimeout(connect, 5000);
      };
    };
    // Open the stream once the page has loaded, so first paint and its data requests are not held up by it.
    const start = () => {
      retry = setTimeout(connect, 1200);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      source?.close();
      clearTimeout(retry);
    };
  }, [live, markSoldOut, setStock]);

  // When the hold's expiry instant arrives, ask the server; show the expiry only once it says so.
  const holdStatus = cart?.hold.status;
  const holdExpires = cart?.hold.expires_at;
  useEffect(() => {
    if (holdStatus !== "active" || !holdExpires) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const fresh = await refreshCart();
      if (!fresh || fresh.hold.status === "active") timer = setTimeout(check, 1000);
    };
    timer = setTimeout(check, Math.max(0, Date.parse(holdExpires) - (Date.now() + clockOffset)));
    return () => clearTimeout(timer);
  }, [holdStatus, holdExpires, clockOffset, refreshCart]);

  const announceCrate = useCallback((text: string) => setCrateMessage(text), []);
  const onReview = useCallback((listener: (event: LiveReview) => void) => {
    reviewListeners.current.add(listener);
    return () => {
      reviewListeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<Shop>(
    () => ({
      user,
      userOutage,
      refreshUser,
      flavours,
      stockUnavailable,
      liveDown,
      liveOpened,
      setStock,
      soldOut,
      markSoldOut,
      cart,
      cartOutage,
      clockOffset,
      setCart,
      refreshCart,
      quote,
      quoteStale,
      requote,
      updateCart,
      crateMessage,
      announceCrate,
      totalMessage,
      onReview,
      watchLive,
    }),
    [user, userOutage, refreshUser, flavours, stockUnavailable, liveDown, liveOpened, setStock, soldOut, markSoldOut, cart, cartOutage, clockOffset, setCart, refreshCart, quote, quoteStale, requote, updateCart, crateMessage, announceCrate, totalMessage, onReview, watchLive],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
