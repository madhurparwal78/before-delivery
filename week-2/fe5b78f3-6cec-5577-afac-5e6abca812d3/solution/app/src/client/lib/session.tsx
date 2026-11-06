// The signed-in traveller, read from GET /api/me when the app opens.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Account } from "../../shared/api";
import { api } from "./api";
import { clearDrafts } from "./draft";

interface Session {
  /** undefined while loading, null when signed out. */
  account: Account | null | undefined;
  signedIn(account: Account): void;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    api<Account>("/api/me").then(setAccount, () => setAccount(null));
  }, []);
  const signOut = useCallback(async () => {
    await api("/api/session", { method: "DELETE" }).catch(() => undefined);
    clearDrafts();
    setAccount(null);
  }, []);
  return <SessionContext.Provider value={{ account, signedIn: setAccount, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
