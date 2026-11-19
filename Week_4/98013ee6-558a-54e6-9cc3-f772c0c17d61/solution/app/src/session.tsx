import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiFailure } from "./lib/api";
import { syncClock } from "./lib/clock";
import { connectLive, disconnectLive } from "./lib/live";
import type { PublicConfig } from "../shared/types";

export interface Me {
  id: number;
  name: string;
  handle: string;
  email: string;
}

interface Session {
  me: Me | null;
  config: PublicConfig;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider is missing");
  return value;
}

/** The signed-in user; only used on screens that are gated behind sign-in. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("not signed in");
  return me;
}

async function loadMe(): Promise<Me | null> {
  try {
    return (await api.get<{ user: Me }>("/api/me")).user;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) return null;
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me | null; config: PublicConfig } | null>(null);

  useEffect(() => {
    void (async () => {
      const [config, me] = await Promise.all([api.get<PublicConfig>("/api/config"), loadMe()]);
      syncClock(config.now);
      if (me) connectLive();
      setState({ me, config });
    })();
  }, []);

  const refresh = useCallback(async () => {
    const me = await loadMe();
    if (me) connectLive();
    else disconnectLive();
    setState((previous) => (previous ? { ...previous, me } : previous));
  }, []);

  const signOut = useCallback(async () => {
    await api.remove("/api/session");
    disconnectLive();
    setState((previous) => (previous ? { ...previous, me: null } : previous));
  }, []);

  const value = useMemo(() => (state ? { me: state.me, config: state.config, refresh, signOut } : null), [state, refresh, signOut]);
  if (!value) return null;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
