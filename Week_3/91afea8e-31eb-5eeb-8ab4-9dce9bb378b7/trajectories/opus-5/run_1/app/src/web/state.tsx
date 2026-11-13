/** Session, guest cart and the cart quote the whole app paints from. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure, onSignedOut } from './api.ts';
import { currentAddress, useRouter } from './router.tsx';
import { cartTotalChange, COPY, MERGE_OUTCOME_COPY } from '../shared/messages.js';
import { formatAmount } from '../shared/format.js';
import type { Account, CartQuote, MergeResult } from '../shared/types.js';

type SessionValue = {
  account: Account | null;
  balancePaise: number;
  loading: boolean;
  reload: () => Promise<void>;
  setAccount: (account: Account | null) => void;
};

const SessionContext = createContext<SessionValue>({
  account: null,
  balancePaise: 0,
  loading: true,
  reload: async () => undefined,
  setAccount: () => undefined,
});

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [account, setAccount] = useState<Account | null>(null);
  const [balancePaise, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const signedIn = useRef(false);
  const { navigate } = useRouter();

  const reload = useCallback(async () => {
    try {
      const me = await api<{ account: Account; balance_paise: number }>('/api/me', {
        allowSignedOut: true,
      });
      setAccount(me.account);
      setBalance(me.balance_paise);
      signedIn.current = true;
    } catch {
      setAccount(null);
      setBalance(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    onSignedOut(() => {
      if (!signedIn.current) return;
      signedIn.current = false;
      setAccount(null);
      sessionStorage.setItem('chauraha_signed_out', '1');
      navigate(`/signin?next=${encodeURIComponent(currentAddress())}`);
    });
  }, [navigate]);

  const value = useMemo<SessionValue>(
    () => ({ account, balancePaise, loading, reload, setAccount }),
    [account, balancePaise, loading, reload],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/* Guest cart: kept in the browser until a full session merges it line by line. */

export type GuestLine = {
  listing_id: string;
  product_id: string;
  title: string;
  price_paise: number;
  quantity: number;
};

const GUEST_KEY = 'chauraha_guest_cart';
const MERGE_KEY = 'chauraha_merge_results';

export function readGuestCart(): GuestLine[] {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GuestLine[]) : [];
  } catch {
    return [];
  }
}

export function writeGuestCart(lines: GuestLine[]): void {
  localStorage.setItem(GUEST_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event('chauraha-guest-cart'));
}

export function addGuestLine(line: GuestLine): void {
  const lines = readGuestCart();
  const existing = lines.find((entry) => entry.listing_id === line.listing_id);
  if (existing === undefined) {
    if (lines.length >= 10) return;
    lines.push({ ...line, quantity: Math.min(line.quantity, 10) });
  } else {
    existing.quantity = Math.min(existing.quantity + line.quantity, 10);
  }
  writeGuestCart(lines);
}

export function clearGuestCart(): void {
  localStorage.removeItem(GUEST_KEY);
  window.dispatchEvent(new Event('chauraha-guest-cart'));
}

type CartValue = {
  quote: CartQuote | null;
  chipTrigger: number;
  guestLines: GuestLine[];
  count: number;
  announcement: string;
  lineMessages: Record<string, string>;
  merge: MergeResult[];
  refresh: () => Promise<void>;
  run: (
    call: () => Promise<CartQuote>,
    options?: { lineId?: string; silent?: boolean },
  ) => Promise<CartQuote | null>;
  addToCart: (line: GuestLine) => Promise<void>;
  mergeGuestCart: () => Promise<void>;
  announce: (message: string) => void;
};

const CartContext = createContext<CartValue>({
  quote: null,
  chipTrigger: 0,
  guestLines: [],
  count: 0,
  announcement: '',
  lineMessages: {},
  merge: [],
  refresh: async () => undefined,
  run: async () => null,
  addToCart: async () => undefined,
  mergeGuestCart: async () => undefined,
  announce: () => undefined,
});

export function CartProvider({ children }: { children: ReactNode }): ReactNode {
  const { account } = useSession();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [guestLines, setGuestLines] = useState<GuestLine[]>(() => readGuestCart());
  const [announcement, setAnnouncement] = useState('');
  const [lineMessages, setLineMessages] = useState<Record<string, string>>({});
  const [merge, setMerge] = useState<MergeResult[]>(() => {
    try {
      const raw = sessionStorage.getItem(MERGE_KEY);
      return raw === null ? [] : (JSON.parse(raw) as MergeResult[]);
    } catch {
      return [];
    }
  });
  const [chipTrigger, setChipTrigger] = useState(0);
  const sequence = useRef(0);
  const lastCod = useRef<boolean | null>(null);

  useEffect(() => {
    const onChange = (): void => setGuestLines(readGuestCart());
    window.addEventListener('chauraha-guest-cart', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('chauraha-guest-cart', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const paint = useCallback((next: CartQuote, silent: boolean) => {
    setQuote(next);
    if (silent) return;
    let message = cartTotalChange(formatAmount(next.payable_paise), next.parcels.length);
    if (next.cod.eligible && lastCod.current === false) {
      message = `${message} ${COPY.codAvailable}`;
    }
    lastCod.current = next.cod.eligible;
    setAnnouncement(message);
  }, []);

  const refresh = useCallback(async () => {
    if (account === null || account.role !== 'shopper') {
      setQuote(null);
      return;
    }
    const mine = ++sequence.current;
    const next = await api<CartQuote>('/api/cart');
    if (mine === sequence.current) {
      setQuote(next);
      lastCod.current = next.cod.eligible;
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (call: () => Promise<CartQuote>, options?: { lineId?: string; silent?: boolean }) => {
      const mine = ++sequence.current;
      try {
        const next = await call();
        if (mine === sequence.current) paint(next, options?.silent === true);
        if (options?.lineId !== undefined) {
          setLineMessages((previous) => {
            const copy = { ...previous };
            delete copy[options.lineId as string];
            return copy;
          });
        }
        return next;
      } catch (error) {
        if (error instanceof ApiFailure) {
          const message =
            error.body.errors === undefined
              ? error.body.message
              : Object.values(error.body.errors)[0] ?? error.body.message;
          if (options?.lineId !== undefined) {
            setLineMessages((previous) => ({ ...previous, [options.lineId as string]: message }));
          }
          setAnnouncement(message);
        }
        return null;
      }
    },
    [paint],
  );

  const addToCart = useCallback(
    async (line: GuestLine) => {
      setChipTrigger((value) => value + 1);
      if (account === null || account.role !== 'shopper') {
        addGuestLine(line);
        return;
      }
      await run(
        () =>
          api<CartQuote>('/api/cart/lines', {
            method: 'POST',
            body: { listing_id: line.listing_id, quantity: line.quantity },
          }),
        { silent: true },
      );
    },
    [account, run],
  );

  const mergeGuestCart = useCallback(async () => {
    const lines = readGuestCart();
    if (lines.length === 0) return;
    try {
      const result = await api<{ results: MergeResult[]; cart: CartQuote }>('/api/cart/merge', {
        method: 'POST',
        body: {
          lines: lines.slice(0, 20).map((line) => ({
            listing_id: line.listing_id,
            quantity: line.quantity,
          })),
        },
      });
      clearGuestCart();
      sessionStorage.setItem(MERGE_KEY, JSON.stringify(result.results));
      setMerge(result.results);
      setQuote(result.cart);
    } catch {
      /* the guest cart stays until a merge succeeds */
    }
  }, []);

  const count =
    account !== null && quote !== null
      ? quote.lines.reduce((sum, line) => sum + line.quantity, 0)
      : guestLines.reduce((sum, line) => sum + line.quantity, 0);

  const value = useMemo<CartValue>(
    () => ({
      quote,
      chipTrigger,
      guestLines,
      count,
      announcement,
      lineMessages,
      merge,
      refresh,
      run,
      addToCart,
      mergeGuestCart,
      announce: setAnnouncement,
    }),
    [
      quote,
      chipTrigger,
      guestLines,
      count,
      announcement,
      lineMessages,
      merge,
      refresh,
      run,
      addToCart,
      mergeGuestCart,
    ],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  return useContext(CartContext);
}

export const mergeCopy = (result: MergeResult): string =>
  result.outcome === 'combined'
    ? MERGE_OUTCOME_COPY.combined(result.title, result.quantity)
    : MERGE_OUTCOME_COPY[result.outcome](result.title);

/* Device and motion preferences. */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useFinePointer(): boolean {
  return useMediaQuery('(pointer: fine)');
}

/** The pincode the shopper last set, kept for the header label and the promise checks. */
const PINCODE_KEY = 'chauraha_pincode';

export function readPincode(): string | null {
  return localStorage.getItem(PINCODE_KEY);
}

export function writePincode(pincode: string): void {
  localStorage.setItem(PINCODE_KEY, pincode);
  window.dispatchEvent(new Event('chauraha-pincode'));
}

export function usePincode(): [string | null, (pincode: string) => void] {
  const [pincode, setPincode] = useState<string | null>(() => readPincode());
  useEffect(() => {
    const onChange = (): void => setPincode(readPincode());
    window.addEventListener('chauraha-pincode', onChange);
    return () => window.removeEventListener('chauraha-pincode', onChange);
  }, []);
  return [pincode, writePincode];
}
