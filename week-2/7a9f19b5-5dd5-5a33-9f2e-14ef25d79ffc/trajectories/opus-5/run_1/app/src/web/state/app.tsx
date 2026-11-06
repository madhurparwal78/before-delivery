/**
 * Application state shared by every screen: the signed-in user, the lighting dial,
 * the comparison tray, the cart count and the router.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api.js";
import { lightStateForHour } from "../../shared/domain.js";
import type { DialMode, LightState, Order, User } from "../../shared/types.js";

/* ---------- reduced motion ---------- */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/* ---------- viewport ---------- */

export type Breakpoint = "phone" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const read = (): Breakpoint => {
    if (typeof innerWidth !== "number") return "desktop";
    if (innerWidth <= 719) return "phone";
    if (innerWidth <= 1023) return "tablet";
    return "desktop";
  };
  const [breakpoint, setBreakpoint] = useState(read);
  useEffect(() => {
    const update = (): void => setBreakpoint(read());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return breakpoint;
}

/* ---------- router ---------- */

interface RouterValue {
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** Changes the query without a reload and without adding a history entry. */
  setQuery: (search: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter used outside the router");
  return value;
}

function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPop = (): void => setLocation({ path: window.location.pathname, search: window.location.search });
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo(0, 0);
  }, []);

  const setQuery = useCallback((search: string) => {
    const next = `${window.location.pathname}${search ? `?${search}` : ""}`;
    history.replaceState(null, "", next);
    setLocation({ path: window.location.pathname, search: search ? `?${search}` : "" });
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ path: location.path, search: location.search, navigate, setQuery }),
    [location.path, location.search, navigate, setQuery],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/* ---------- session and the lighting dial ---------- */

interface SessionValue {
  user: User | null;
  ready: boolean;
  setUser: (user: User | null) => void;
  refresh: () => Promise<void>;
  dialMode: DialMode;
  lightState: LightState;
  setDialMode: (mode: DialMode) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession used outside the session provider");
  return value;
}

const DIAL_STORAGE_KEY = "lf_dial_mode";
const DIAL_MODES: readonly DialMode[] = ["auto", "morning", "day", "evening", "night", "gallery"];

function storedDialMode(): DialMode {
  try {
    const raw = localStorage.getItem(DIAL_STORAGE_KEY);
    if (raw && (DIAL_MODES as readonly string[]).includes(raw)) return raw as DialMode;
  } catch {
    // A browser that refuses storage simply falls back to Auto.
  }
  return "auto";
}

/** Auto works out the state from the viewer's local hour. */
function resolveLightState(mode: DialMode): LightState {
  return mode === "auto" ? lightStateForHour(new Date().getHours()) : mode;
}

function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [dialMode, setMode] = useState<DialMode>(storedDialMode);
  const [lightState, setLightState] = useState<LightState>(() => resolveLightState(storedDialMode()));

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.me();
      setUser(me);
      // A signed-in user's saved choice is applied when they next load any page.
      setMode(me.dial_mode);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto re-checks every minute and changes state when the hour crosses a band.
  useEffect(() => {
    setLightState(resolveLightState(dialMode));
    if (dialMode !== "auto") return;
    const timer = setInterval(() => setLightState(resolveLightState("auto")), 60_000);
    return () => clearInterval(timer);
  }, [dialMode]);

  useEffect(() => {
    document.documentElement.dataset.light = lightState;
    document.documentElement.dataset.lightMode = dialMode;
  }, [lightState, dialMode]);

  const setDialMode = useCallback(
    (mode: DialMode) => {
      setMode(mode);
      try {
        localStorage.setItem(DIAL_STORAGE_KEY, mode);
      } catch {
        // A signed-out visitor without storage keeps the choice for this page only.
      }
      void api.setDial(mode).catch(() => undefined);
    },
    [],
  );

  const value = useMemo<SessionValue>(
    () => ({ user, ready, setUser, refresh, dialMode, lightState, setDialMode }),
    [user, ready, refresh, dialMode, lightState, setDialMode],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/* ---------- comparison tray ---------- */

export interface TrayEntry {
  code: string;
  productName: string;
  productSlug: string;
}

interface TrayValue {
  entries: TrayEntry[];
  status: string;
  add: (entry: TrayEntry) => boolean;
  remove: (code: string) => void;
  has: (code: string) => boolean;
  hasProduct: (productName: string) => boolean;
}

const TrayContext = createContext<TrayValue | null>(null);

export function useTray(): TrayValue {
  const value = useContext(TrayContext);
  if (!value) throw new Error("useTray used outside the tray provider");
  return value;
}

const TRAY_STORAGE_KEY = "lf_compare_tray";
export const TRAY_LIMIT = 4;

function storedTray(): TrayEntry[] {
  try {
    const raw = localStorage.getItem(TRAY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is TrayEntry => typeof entry === "object" && entry !== null && "code" in entry)
      .slice(0, TRAY_LIMIT);
  } catch {
    return [];
  }
}

function TrayProvider({ children }: { children: ReactNode }): ReactNode {
  const [entries, setEntries] = useState<TrayEntry[]>(storedTray);
  const [status, setStatus] = useState("");

  // The tray contents are kept in the browser across pages.
  useEffect(() => {
    try {
      localStorage.setItem(TRAY_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Without storage the tray simply lasts for this page.
    }
  }, [entries]);

  const add = useCallback((entry: TrayEntry): boolean => {
    let accepted = false;
    setEntries((current) => {
      if (current.some((held) => held.code === entry.code)) {
        accepted = true;
        return current;
      }
      if (current.length >= TRAY_LIMIT) return current;
      accepted = true;
      return [...current, entry];
    });
    return accepted;
  }, []);

  const value = useMemo<TrayValue>(
    () => ({
      entries,
      status,
      add: (entry) => {
        const accepted = add(entry);
        setStatus(accepted ? "Added to comparison." : "You can compare up to four fittings.");
        return accepted;
      },
      remove: (code) => {
        setEntries((current) => current.filter((entry) => entry.code !== code));
        setStatus("");
      },
      has: (code) => entries.some((entry) => entry.code === code),
      hasProduct: (productName) => entries.some((entry) => entry.productName === productName),
    }),
    [entries, status, add],
  );

  return <TrayContext.Provider value={value}>{children}</TrayContext.Provider>;
}

/* ---------- cart ---------- */

interface CartValue {
  order: Order | null;
  count: number;
  refresh: () => Promise<void>;
  setOrder: (order: Order) => void;
}

const CartContext = createContext<CartValue | null>(null);

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart used outside the cart provider");
  return value;
}

function CartProvider({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();
  const [order, setOrder] = useState<Order | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setOrder(null);
      return;
    }
    try {
      const { order: cart } = await api.cart();
      setOrder(cart);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setOrder(null);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CartValue>(
    () => ({
      order,
      count: order?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0,
      refresh,
      setOrder,
    }),
    [order, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/* ---------- a polite live region, announced once per message ---------- */

/**
 * Holds the current message for a named live region. The text is kept exactly as
 * published, so nothing is appended to force a repeat announcement.
 */
export function useAnnouncer(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => setMessage(next), []);
  return { message, announce };
}

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <RouterProvider>
      <SessionProvider>
        <TrayProvider>
          <CartProvider>{children}</CartProvider>
        </TrayProvider>
      </SessionProvider>
    </RouterProvider>
  );
}
