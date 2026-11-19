import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Role } from "../shared/rules";
import { api, type Me } from "./api";

interface Session {
  me: Me | null;
  loaded: boolean;
  has: (role: Role) => boolean;
}

const SessionContext = createContext<Session>({ me: null, loaded: false, has: () => false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });
  useEffect(() => {
    void api<Me>("GET", "/api/me").then((result) => setState({ me: result.ok ? result.data : null, loaded: true }));
  }, []);
  const has = useCallback((role: Role) => state.me?.roles.includes(role) ?? false, [state.me]);
  return <SessionContext.Provider value={{ ...state, has }}>{children}</SessionContext.Provider>;
}

export const useSession = (): Session => useContext(SessionContext);

function media(query: string): [subscribe: (fn: () => void) => () => void, read: () => boolean] {
  const list = window.matchMedia(query);
  return [
    (fn) => {
      list.addEventListener("change", fn);
      return () => list.removeEventListener("change", fn);
    },
    () => list.matches,
  ];
}

function useMedia(query: string): boolean {
  const [subscribe, read] = useState(() => media(query))[0];
  return useSyncExternalStore(subscribe, read);
}

export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

/** The published viewport a width belongs to: phone below 768, tablet 768 to 1279, desktop from 1280. */
export function useViewport(): "phone" | "tablet" | "desktop" {
  const desktop = useMedia("(min-width: 1280px)");
  const tablet = useMedia("(min-width: 768px)");
  return desktop ? "desktop" : tablet ? "tablet" : "phone";
}
