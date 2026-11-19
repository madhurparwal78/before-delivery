// The signed-in caller, loaded from /api/me once and refreshed after sign-in and sign-out.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MeResponse } from "../../shared/api.ts";
import { ApiFailure, api, get } from "./api.ts";
import { bootstrap } from "./bootstrap.ts";

interface SessionValue {
  /** `loading` until /api/me answered. */
  ready: boolean;
  me: MeResponse | null;
  signIn(email: string, password: string): Promise<void>;
  /** Adopts a session started elsewhere (invitation activation). */
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const Session = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<{ ready: boolean; me: MeResponse | null }>({ ready: false, me: null });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const me = await get<MeResponse>("/api/me");
      bootstrap.timeZone = me.timeZone;
      setState({ ready: true, me });
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
      setState({ ready: true, me: null });
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      ...state,
      refresh,
      async signIn(email, password) {
        await api("POST", "/api/session", { email, password });
        await refresh();
      },
      async signOut() {
        await api("DELETE", "/api/session");
        setState({ ready: true, me: null });
      },
    }),
    [state, refresh],
  );
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(Session);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
