// Who is signed in. The cookie is HttpOnly; the browser only ever learns the user through /api/me.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import type { User } from "./types.ts";

type SessionState = { user: User | null; ready: boolean; refresh: () => Promise<User | null>; signOut: () => Promise<void> };

const SessionContext = createContext<SessionState>({ user: null, ready: false, refresh: async () => null, signOut: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const r = await api.get<{ user: User }>("/api/me");
    const next = r.ok ? r.data.user : null;
    setUser(next);
    setReady(true);
    return next;
  }, []);
  const signOut = useCallback(async () => {
    await api.post("/api/auth/signout");
    setUser(null);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <SessionContext.Provider value={{ user, ready, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
