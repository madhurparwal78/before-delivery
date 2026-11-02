import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CRATE_SIZE,
  type Cadence,
  type FlavourSlug,
  type ProvinceCode,
  FLAVOURS,
  flavourName,
  provinceName,
} from '../../../shared/catalogue.js';
import { crateCopy, totalsCopy } from '../../../shared/copy.js';
import { shippingPhrase, type Quote } from '../../../shared/quote.js';
import {
  ApiCallError,
  api,
  type CartPayload,
  type FlavourSummary,
  type ReviewPayload,
  type SessionUser,
} from '../api.js';
import { launchFlight } from './flights.js';
import { prefersReducedMotion } from './useReducedMotion.js';

interface ShopValue {
  user: SessionUser | null;
  userLoaded: boolean;
  setUser: (user: SessionUser | null) => void;
  flavours: FlavourSummary[];
  stockLeft: Record<string, number> | null;
  liveConnected: boolean;
  cart: CartPayload | null;
  pendingSlots: Record<number, FlavourSlug>;
  soldOut: Record<string, boolean>;
  quote: Quote | null;
  quoteStale: boolean;
  crateMessage: string;
  totalMessage: string;
  holdExpired: boolean;
  cartOpen: boolean;
  serverOffsetMs: number;
  reviewFeed: Record<string, ReviewPayload[]>;
  addCan: (flavour: FlavourSlug) => Promise<void>;
  fillCrate: (flavour: FlavourSlug) => Promise<void>;
  removeCan: (slotIndex: number) => Promise<void>;
  setProvince: (province: ProvinceCode) => Promise<void>;
  setSubscribe: (subscribe: boolean) => Promise<void>;
  setCadence: (cadence: Cadence) => Promise<void>;
  openCart: () => void;
  closeCart: () => void;
  refreshCart: () => Promise<CartPayload | null>;
  refreshFlavours: () => Promise<void>;
}

const ShopContext = createContext<ShopValue | null>(null);

function cansOf(cart: CartPayload | null): Array<{ flavour: FlavourSlug; quantity: number }> {
  const counts = new Map<FlavourSlug, number>();
  for (const slot of cart?.slots ?? []) {
    if (slot === null) continue;
    counts.set(slot.flavour, (counts.get(slot.flavour) ?? 0) + 1);
  }
  return FLAVOURS.filter((flavour) => counts.has(flavour.slug)).map((flavour) => ({
    flavour: flavour.slug,
    quantity: counts.get(flavour.slug)!,
  }));
}

function emptySlots(cart: CartPayload | null, pending: Record<number, FlavourSlug>): number[] {
  const slots: number[] = [];
  for (let index = 0; index < CRATE_SIZE; index += 1) {
    if ((cart?.slots[index] ?? null) === null && pending[index] === undefined) slots.push(index);
  }
  return slots;
}

export function ShopProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [flavours, setFlavours] = useState<FlavourSummary[]>([]);
  const [stockLeft, setStockLeft] = useState<Record<string, number> | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [cart, setCart] = useState<CartPayload | null>(null);
  const [pendingSlots, setPendingSlots] = useState<Record<number, FlavourSlug>>({});
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [crateMessage, setCrateMessage] = useState('');
  const [totalMessage, setTotalMessage] = useState('');
  const [holdExpired, setHoldExpired] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [reviewFeed, setReviewFeed] = useState<Record<string, ReviewPayload[]>>({});

  const cartRef = useRef<CartPayload | null>(null);
  cartRef.current = cart;
  const quoteRef = useRef<Quote | null>(null);
  quoteRef.current = quote;

  const applyCart = useCallback((next: CartPayload) => {
    setCart(next);
    setServerOffsetMs(Date.parse(next.server_time) - Date.now());
    if (next.hold.status === 'expired') setHoldExpired(true);
    if (next.hold.status === 'active') setHoldExpired(false);
  }, []);

  const fetchQuote = useCallback(
    async (next: CartPayload): Promise<Quote | null> => {
      try {
        const fresh = await api.post<Quote>('/api/quote', {
          province: next.province,
          subscribe: next.subscribe,
          cans: cansOf(next),
        });
        setQuote(fresh);
        setQuoteStale(false);
        return fresh;
      } catch {
        setQuoteStale(true);
        setTotalMessage(totalsCopy.outage);
        return null;
      }
    },
    [],
  );

  const refreshFlavours = useCallback(async () => {
    try {
      const payload = await api.get<{ flavours: FlavourSummary[] }>('/api/flavours');
      setFlavours(payload.flavours);
      setStockLeft(
        Object.fromEntries(payload.flavours.map((flavour) => [flavour.slug, flavour.stock_left])),
      );
      setSoldOut((current) => {
        const next = { ...current };
        for (const flavour of payload.flavours) {
          if (flavour.stock_left > 0) delete next[flavour.slug];
          else next[flavour.slug] = true;
        }
        return next;
      });
    } catch {
      setStockLeft(null);
    }
  }, []);

  const refreshCart = useCallback(async () => {
    try {
      const payload = await api.get<{ cart: CartPayload }>('/api/cart');
      applyCart(payload.cart);
      void fetchQuote(payload.cart);
      return payload.cart;
    } catch {
      setQuoteStale(true);
      return null;
    }
  }, [applyCart, fetchQuote]);

  useEffect(() => {
    void api
      .get<{ user: SessionUser | null }>('/api/me')
      .then((payload) => setUser(payload.user))
      .catch(() => setUser(null))
      .finally(() => setUserLoaded(true));
    void refreshFlavours();
    void refreshCart();
  }, [refreshCart, refreshFlavours]);

  /** The live feed keeps stock-left counts and approved reviews current. */
  useEffect(() => {
    const source = new EventSource('/api/live');
    source.onopen = () => setLiveConnected(true);
    source.onerror = () => setLiveConnected(false);
    source.addEventListener('stock', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        flavour: string;
        stock_left: number;
      };
      setStockLeft((current) => ({ ...(current ?? {}), [payload.flavour]: payload.stock_left }));
      setSoldOut((current) => {
        if (payload.stock_left > 0) {
          if (current[payload.flavour] === undefined) return current;
          const next = { ...current };
          delete next[payload.flavour];
          return next;
        }
        return { ...current, [payload.flavour]: true };
      });
    });
    source.addEventListener('review', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        flavour: string;
        review: ReviewPayload;
      };
      setReviewFeed((current) => ({
        ...current,
        [payload.flavour]: [
          payload.review,
          ...(current[payload.flavour] ?? []).filter(
            (review) => review.id !== payload.review.id,
          ),
        ],
      }));
    });
    return () => source.close();
  }, []);

  const phraseFor = useCallback((fresh: Quote | null, province: ProvinceCode) => {
    const effective = fresh ?? quoteRef.current;
    if (effective === null) return '';
    return shippingPhrase(effective, provinceName(province));
  }, []);

  const reserve = useCallback(
    async (flavour: FlavourSlug, quantity: number) => {
      const current = cartRef.current;
      const targets = emptySlots(current, pendingSlots).slice(0, quantity);
      const reduced = prefersReducedMotion();

      setPendingSlots((slots) => {
        const next = { ...slots };
        for (const slot of targets) next[slot] = flavour;
        return next;
      });
      if (!reduced) {
        targets.forEach((slot, index) => {
          window.setTimeout(() => launchFlight(flavour, slot, 'drop'), index * 60);
        });
      }

      try {
        const payload = await api.post<{
          cart: CartPayload;
          added: { flavour: FlavourSlug; slots: number[] };
          stock_left: number;
        }>('/api/cart/items', { flavour, quantity });
        applyCart(payload.cart);
        setStockLeft((currentStock) => ({
          ...(currentStock ?? {}),
          [flavour]: payload.stock_left,
        }));
        setPendingSlots((slots) => {
          const next = { ...slots };
          for (const slot of targets) delete next[slot];
          return next;
        });
        const fresh = await fetchQuote(payload.cart);
        const phrase = phraseFor(fresh, payload.cart.province);
        setCrateMessage(
          quantity === 1
            ? crateCopy.added(flavourName(flavour), payload.cart.count, payload.stock_left, phrase)
            : crateCopy.filled(
                payload.added.slots.length,
                flavourName(flavour),
                payload.cart.count,
                payload.stock_left,
                phrase,
              ),
        );
      } catch (error) {
        setPendingSlots((slots) => {
          const next = { ...slots };
          for (const slot of targets) delete next[slot];
          return next;
        });
        if (!reduced) {
          for (const slot of targets) launchFlight(flavour, slot, 'return');
        }
        const failure = error instanceof ApiCallError ? error.failure : null;
        const count = cartRef.current?.count ?? 0;
        const stock = failure?.stock_left ?? stockLeft?.[flavour] ?? 0;
        const phrase = phraseFor(null, cartRef.current?.province ?? 'ON');
        if (failure?.error === 'sold_out') {
          setSoldOut((current) => ({ ...current, [flavour]: true }));
          setStockLeft((current) => ({ ...(current ?? {}), [flavour]: stock }));
          setCrateMessage(crateCopy.soldOut(flavourName(flavour), count, stock, phrase));
        } else if (failure?.error === 'hold_limit') {
          setCrateMessage(
            failure.limit === 'crate'
              ? crateCopy.crateFull(flavourName(flavour), count, stock, phrase)
              : crateCopy.dropLimit(flavourName(flavour), count, stock, phrase),
          );
        } else {
          setCrateMessage(crateCopy.storeOutage);
        }
      }
    },
    [applyCart, fetchQuote, pendingSlots, phraseFor, stockLeft],
  );

  const addCan = useCallback((flavour: FlavourSlug) => reserve(flavour, 1), [reserve]);

  const fillCrate = useCallback(
    (flavour: FlavourSlug) => {
      const free = emptySlots(cartRef.current, pendingSlots).length;
      return reserve(flavour, Math.max(1, free));
    },
    [pendingSlots, reserve],
  );

  const removeCan = useCallback(
    async (slotIndex: number) => {
      const slot = cartRef.current?.slots[slotIndex] ?? null;
      if (slot === null) return;
      try {
        const payload = await api.delete<{ cart: CartPayload; stock_left: number }>(
          `/api/cart/items/${slotIndex}`,
        );
        applyCart(payload.cart);
        setStockLeft((current) => ({
          ...(current ?? {}),
          [slot.flavour]: payload.stock_left,
        }));
        if (payload.stock_left > 0) {
          setSoldOut((current) => {
            if (current[slot.flavour] === undefined) return current;
            const next = { ...current };
            delete next[slot.flavour];
            return next;
          });
        }
        const fresh = await fetchQuote(payload.cart);
        setCrateMessage(
          crateCopy.removed(
            flavourName(slot.flavour),
            payload.cart.count,
            phraseFor(fresh, payload.cart.province),
          ),
        );
      } catch {
        setCrateMessage(crateCopy.storeOutage);
      }
    },
    [applyCart, fetchQuote, phraseFor],
  );

  const patchCart = useCallback(
    async (patch: Record<string, unknown>, announceTotal: boolean) => {
      try {
        const payload = await api.patch<{ cart: CartPayload }>('/api/cart', patch);
        applyCart(payload.cart);
        const fresh = await fetchQuote(payload.cart);
        if (announceTotal && fresh !== null) {
          setTotalMessage(
            totalsCopy.success(fresh.total_cents, provinceName(payload.cart.province)),
          );
        }
      } catch {
        setQuoteStale(true);
        setTotalMessage(totalsCopy.outage);
      }
    },
    [applyCart, fetchQuote],
  );

  const setProvince = useCallback(
    (province: ProvinceCode) => patchCart({ province }, true),
    [patchCart],
  );
  const setSubscribe = useCallback(
    (subscribe: boolean) => patchCart({ subscribe }, true),
    [patchCart],
  );
  const setCadence = useCallback(
    (cadence: Cadence) => patchCart({ cadence }, true),
    [patchCart],
  );

  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

  /** When the hold runs out, the expired state shows only once the server says so. */
  useEffect(() => {
    const expiresAt = cart?.hold.expires_at;
    if (expiresAt === null || expiresAt === undefined) return;
    const due = Date.parse(expiresAt) - serverOffsetMs - Date.now();
    const timer = window.setTimeout(
      () => {
        void refreshCart();
      },
      Math.max(0, due) + 250,
    );
    return () => window.clearTimeout(timer);
  }, [cart?.hold.expires_at, refreshCart, serverOffsetMs]);

  useEffect(() => {
    if (!holdExpired) return;
    setCrateMessage(crateCopy.holdExpired);
  }, [holdExpired]);

  useEffect(() => {
    if (cart?.hold.status !== 'none') return;
    const timer = window.setInterval(() => {
      void refreshCart();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [cart?.hold.status, refreshCart]);

  const value = useMemo<ShopValue>(
    () => ({
      user,
      userLoaded,
      setUser,
      flavours,
      stockLeft,
      liveConnected,
      cart,
      pendingSlots,
      soldOut,
      quote,
      quoteStale,
      crateMessage,
      totalMessage,
      holdExpired,
      cartOpen,
      serverOffsetMs,
      reviewFeed,
      addCan,
      fillCrate,
      removeCan,
      setProvince,
      setSubscribe,
      setCadence,
      openCart,
      closeCart,
      refreshCart,
      refreshFlavours,
    }),
    [
      addCan,
      cart,
      cartOpen,
      closeCart,
      crateMessage,
      fillCrate,
      flavours,
      holdExpired,
      liveConnected,
      openCart,
      pendingSlots,
      quote,
      quoteStale,
      refreshCart,
      refreshFlavours,
      removeCan,
      reviewFeed,
      serverOffsetMs,
      setCadence,
      setProvince,
      setSubscribe,
      soldOut,
      stockLeft,
      totalMessage,
      user,
      userLoaded,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopValue {
  const value = useContext(ShopContext);
  if (value === null) throw new Error('useShop needs a ShopProvider');
  return value;
}

export { cansOf };
