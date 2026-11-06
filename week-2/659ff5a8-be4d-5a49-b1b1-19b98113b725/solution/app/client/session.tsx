import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { SessionUser } from "../shared/api.js";
import { ApiFailure, api } from "./api.js";

/** The signed-in user as the server reports it, read once on load and replaced on sign-in and sign-out. */
function useSessionSource() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api
      .get<{ user: SessionUser }>("/api/session")
      .then((result) => setUser(result.user))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
      })
      .finally(() => setReady(true));
  }, []);
  const signOut = useCallback(async () => {
    await api.delete("/api/session");
    setUser(null);
  }, []);
  return { user, ready, setUser, signOut };
}

const SessionContext = createContext<ReturnType<typeof useSessionSource> | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionContext.Provider value={useSessionSource()}>{children}</SessionContext.Provider>;
}

export function useSession(): ReturnType<typeof useSessionSource> {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing");
  return value;
}

export function useUser(): SessionUser {
  const { user } = useSession();
  if (!user) throw new Error("a signed-in screen rendered without a session");
  return user;
}

export const isStaff = (user: SessionUser, role: "chair" | "timing" | "workers"): boolean =>
  user.roles.includes("chair") || user.roles.includes(role);
