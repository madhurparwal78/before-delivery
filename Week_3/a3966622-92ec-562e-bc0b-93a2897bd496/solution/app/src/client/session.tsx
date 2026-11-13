// The signed-in user and the live service state shared by every screen.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ServiceStates, SessionUser } from "../shared/types";
import { get, request } from "./api";
import { loadPort } from "./port";
import { navigate } from "./router";

const SERVICE_POLL_MS = 10_000;

interface Session {
  user: SessionUser | null;
  ready: boolean;
  services: ServiceStates | null;
  signedIn: (user: SessionUser) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [services, setServices] = useState<ServiceStates | null>(null);

  useEffect(() => {
    // A signed-in screen first paints with its service chips and any outage line already in the top
    // strip, so they never arrive late and push the screen down.
    void get<{ user: SessionUser }>("/api/session").then(async (outcome) => {
      if (outcome.kind === "ok") {
        const [states] = await Promise.all([get<ServiceStates>("/api/services"), loadPort()]);
        if (states.kind === "ok") setServices(states.data);
        setUser(outcome.data.user);
      } else setUser(null);
      setReady(true);
    });
    void loadPort();
  }, []);

  useEffect(() => {
    if (!user) return;
    const read = (): void => {
      void get<ServiceStates>("/api/services").then((outcome) => {
        if (outcome.kind === "ok") setServices(outcome.data);
      });
    };
    read();
    const timer = setInterval(read, SERVICE_POLL_MS);
    return () => clearInterval(timer);
  }, [user]);

  const signOut = useCallback(async () => {
    await request("/api/session", { method: "DELETE" });
    setUser(null);
    setServices(null);
    navigate("/login");
  }, []);

  return (
    <SessionContext.Provider value={{ user, ready, services, signedIn: setUser, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

/** The signed-in user on a screen that only renders once someone is signed in. */
export function useUser(): SessionUser {
  const { user } = useSession();
  if (!user) throw new Error("useUser on a signed-out screen");
  return user;
}
