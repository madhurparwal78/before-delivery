// Who is signed in, and where each role and status lands.

import { createContext, useContext } from "react";
import type { UserView } from "../shared/api.js";

export interface Session {
  user: UserView;
  /** Re-reads the signed-in user (after a status change). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside a signed-in screen");
  return session;
}

export function landingFor(user: UserView): string {
  if (user.role === "operator") return "/operator";
  if (user.role === "shift_lead") return "/shift";
  return user.renter_status === "applied" || user.renter_status === "documents_review" ? "/kitchen" : "/board";
}

/** Whether a signed-in user may use a screen. */
export function mayOpen(path: string, user: UserView): boolean {
  if (path === "/board") return true;
  if (path === "/kitchen") return user.role === "renter";
  if (path === "/operator") return user.role === "operator";
  if (path === "/shift") return user.role !== "renter";
  return path.startsWith("/share/");
}
