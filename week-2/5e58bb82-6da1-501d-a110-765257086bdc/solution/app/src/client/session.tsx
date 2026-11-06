// The signed-in user. Signing out revokes the session and drops everything the browser held for it.
import { createContext, useContext } from "react";
import { api, newEpoch, quietly, type Units, type User } from "./api";

export interface Session {
  user: User;
  setUnits: (units: Units) => void;
  signOut: (after?: { next?: string; idle?: boolean }) => void;
  /** A different account signed in elsewhere in the page (the upload dialog). */
  switchTo: (user: User, home: string) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside a signed-in screen");
  return session;
}

const resets = new Set<() => void>();

/** Browser-held state registers how to drop itself on sign-out (held uploads, the offline queue). */
export function onSignOut(reset: () => void): void {
  resets.add(reset);
}

/** Ends the current epoch: late responses are discarded and every held record is dropped. */
export function dropBrowserState(): void {
  newEpoch();
  for (const reset of resets) reset();
}

export function revoke(): void {
  quietly(api("/api/session", { method: "DELETE", own401: true }));
}

export const HOMES: Record<User["role"], string> = {
  principal_surveyor: "/fleet",
  launch_technician: "/launch",
  client_reviewer: "/surveys",
};
