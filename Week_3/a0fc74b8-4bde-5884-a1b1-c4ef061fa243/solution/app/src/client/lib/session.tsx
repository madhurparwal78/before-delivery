import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LiveEvent, Role, SessionJson } from "../../shared/types";
import { ApiFailure, api } from "./api";
import { useLiveEvents } from "./live";

interface Me extends SessionJson {
  notice: string;
}

const SessionContext = createContext<Me | null>(null);

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", member: "Member", viewer: "Viewer" };

export function SessionProvider({ children, onSignedOut }: { children: ReactNode; onSignedOut: () => void }) {
  const [session, setSession] = useState<SessionJson | null>(null);
  const [notice, setNotice] = useState("");
  const role = useRef<Role | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.get<SessionJson>("/api/session");
      if (role.current !== null && role.current !== next.role) setNotice(`Your role is now ${ROLE_LABEL[next.role]}.`);
      role.current = next.role;
      setSession(next);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) onSignedOut();
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEvents((event: LiveEvent) => {
    if (event.type === "resync" || (event.type === "role" && session && event.userId === session.user.id)) void load();
  });

  const value = useMemo(() => (session ? { ...session, notice } : null), [session, notice]);
  if (!value) return null;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useMe(): Me {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing");
  return value;
}
