// The signed-in person and the practice, shared by every screen of the shell.
import { createContext, useContext } from "react";
import type { Practice, User } from "./api";

interface Session {
  user: User;
  practice: Practice;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside the signed-in shell");
  return session;
}
