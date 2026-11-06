import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DialMode } from "../../shared/dial";
import type { Order, User } from "../../shared/types";
import { request } from "./api";
import { setDialMode } from "./dial";

interface Session {
  user: User | null;
  ready: boolean;
  /** Approved trade buyers see trade prices, projects and monthly account. */
  approvedTrade: boolean;
  /** Approved trade buyers and admins see trade prices. */
  seesTrade: boolean;
  cartCount: number;
  signedIn: (user: User) => void;
  signOut: () => Promise<void>;
  refreshCart: () => void;
  chooseLight: (mode: DialMode) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  // A dial choice made while the session is still loading wins over the stored one and is saved once it loads.
  const earlyLight = useRef<DialMode | null>(null);

  const refreshCart = useCallback(() => {
    void request<{ order: Order }>("/api/cart").then((reply) => {
      setCartCount(reply.ok ? reply.data.order.lines.reduce((sum, line) => sum + line.quantity, 0) : 0);
    });
  }, []);

  const signedIn = useCallback(
    (next: User) => {
      setUser(next);
      setDialMode(next.dial_mode);
      refreshCart();
    },
    [refreshCart],
  );

  useEffect(() => {
    void request<{ user: User }>("/api/me").then((reply) => {
      const chosen = earlyLight.current;
      earlyLight.current = null;
      if (reply.ok) {
        const stored = reply.data.user;
        signedIn(chosen ? { ...stored, dial_mode: chosen } : stored);
        if (chosen && chosen !== stored.dial_mode) void request("/api/me/dial", { method: "PUT", body: { mode: chosen } });
      }
      setReady(true);
    });
  }, [signedIn]);

  const value = useMemo<Session>(() => {
    const approvedTrade = user?.role === "trade" && user.trade_status === "approved";
    return {
      user,
      ready,
      approvedTrade,
      seesTrade: approvedTrade || user?.role === "admin",
      cartCount,
      signedIn,
      refreshCart,
      async signOut() {
        await request("/api/auth/signout", { method: "POST" });
        setUser(null);
        setCartCount(0);
      },
      chooseLight(mode) {
        setDialMode(mode);
        if (user) void request("/api/me/dial", { method: "PUT", body: { mode } });
        else if (!ready) earlyLight.current = mode;
      },
    };
  }, [user, ready, cartCount, signedIn, refreshCart]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
