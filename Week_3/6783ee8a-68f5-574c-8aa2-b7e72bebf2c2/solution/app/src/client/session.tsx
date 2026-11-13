import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppConfig, User } from "../shared/api";
import { get, post } from "./api";

interface Session {
  /** undefined while the first answer is pending, null when signed out. */
  user: User | null | undefined;
  config: AppConfig | null;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    get<{ user: User }>("/api/me").then(
      (found) => setUser(found.user),
      () => setUser(null),
    );
    get<AppConfig>("/api/config").then(setConfig, () => undefined);
  }, []);
  const signOut = useCallback(async () => {
    await post("/api/auth/signout");
    setUser(null);
  }, []);
  const value = useMemo(() => ({ user, config, setUser, signOut }), [user, config, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is missing");
  return session;
}
