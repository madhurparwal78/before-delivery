import { createContext, useContext, useState, type ReactNode } from "react";
import { boot } from "./lib/api";
import type { User } from "../shared/domain";

interface SessionValue {
  user: User | null;
  setUser: (user: User | null) => void;
}

const SessionContext = createContext<SessionValue>({ user: null, setUser: () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(boot.user);
  return <SessionContext.Provider value={{ user, setUser }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** Where each role lands after signing in. */
export function homeFor(user: User): string {
  return user.role === "studio_owner" ? "/studio" : "/portal";
}
