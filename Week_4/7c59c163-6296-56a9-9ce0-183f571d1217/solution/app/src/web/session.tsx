import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "../shared/rules";
import { api, type Me } from "./api";

type SessionState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: Me };

const SessionContext = createContext<{ session: SessionState; refresh: () => void }>({ session: { status: "loading" }, refresh: () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const load = () => {
    api<Me>("/api/me")
      .then((me) => setSession({ status: "signed-in", me }))
      .catch(() => setSession({ status: "signed-out" }));
  };
  useEffect(load, []);
  return <SessionContext.Provider value={{ session, refresh: load }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

/** The signed-in member; only used inside screens that require a session. */
export function useMe(): Me {
  const { session } = useSession();
  if (session.status !== "signed-in") throw new Error("useMe outside a signed-in screen");
  return session.me;
}

export function hasRole(me: Me, role: Role): boolean {
  return me.roles.includes(role);
}
