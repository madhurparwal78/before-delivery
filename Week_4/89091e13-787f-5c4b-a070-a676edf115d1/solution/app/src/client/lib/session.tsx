import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me } from "../../shared/api.ts";
import { api, ApiError } from "./api.ts";

interface Session {
  status: "loading" | "out" | "in";
  me: Me | null;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Session["status"]; me: Me | null }>({ status: "loading", me: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("GET", "/api/me");
      setState({ status: "in", me });
      return me;
    } catch (caught) {
      if (!(caught instanceof ApiError) || caught.status !== 401) throw caught;
      setState({ status: "out", me: null });
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api<void>("DELETE", "/api/session");
    setState({ status: "out", me: null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ ...state, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("useMe while signed out");
  return me;
}
