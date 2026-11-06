// The signed-in member, read from GET /api/session.
import { createContext, useContext } from "react";
import { type User } from "./types.js";

interface SessionValue {
  user: User;
  setUser(user: User | null): void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside a signed-in screen");
  return value;
}
