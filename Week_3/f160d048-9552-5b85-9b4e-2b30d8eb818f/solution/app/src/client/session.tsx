import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post } from "./api";
import { openLive } from "./live";
import { navigate } from "./router";
import type { Me } from "../shared/api";

type SessionValue = {
  me: Me | null;
  ready: boolean;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue>({ me: null, ready: false, refresh: async () => null, signOut: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const result = await get<Me>("/api/me");
    const next = result.ok ? result.data : null;
    setMe(next);
    setReady(true);
    return next;
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (ready) openLive();
  }, [ready, me?.id]);
  const signOut = useCallback(async () => {
    await post("/api/auth/sign-out");
    setMe(null);
    navigate("/");
  }, []);
  const value = useMemo(() => ({ me, ready, refresh, signOut }), [me, ready, refresh, signOut]);
  // Paint nothing until /api/me answers: the header's links depend on the role, and swapping the signed-out set
  // for a longer one re-wraps the header and pushes the whole page down.
  return <SessionContext.Provider value={value}>{ready ? children : null}</SessionContext.Provider>;
}

export const useSession = (): SessionValue => useContext(SessionContext);
