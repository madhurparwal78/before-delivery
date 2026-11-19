import { createContext, useContext } from "react";
import { api, discardInFlight } from "./lib/api";
import { clearAllScreens } from "./lib/persist";
import { navigate } from "./lib/router";
import { classifyRoute, roleOfRoute } from "../shared/routes";
import type { Me, Role } from "./types";

interface SessionValue {
  me: Me | null;
  setMe: (me: Me | null) => void;
}

export const SessionContext = createContext<SessionValue>({ me: null, setMe: () => undefined });

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** The signed-in person; screens only render for a signed-in session. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("a signed-in screen rendered without a session");
  return me;
}

const SIGN_IN_KEY = "tramela:sign-in";

interface SignInMemory {
  email: string;
  focus: "email" | "password" | "submit" | "alert";
  alert: string;
}

export function readSignInMemory(): SignInMemory | null {
  const raw = sessionStorage.getItem(SIGN_IN_KEY);
  return raw === null ? null : (JSON.parse(raw) as SignInMemory);
}

export function writeSignInMemory(memory: SignInMemory): void {
  sessionStorage.setItem(SIGN_IN_KEY, JSON.stringify(memory));
}

export function clearSignInMemory(): void {
  sessionStorage.removeItem(SIGN_IN_KEY);
}

export const SESSION_ENDED_COPY = "Your session ended. Sign in to continue.";

/** Sign out: end the session, drop everything in flight and saved, and go to /sign-in. */
export async function signOut(setMe: (me: Me | null) => void): Promise<void> {
  const ending = api<void>("DELETE", "/api/session").catch(() => undefined);
  discardInFlight();
  clearAllScreens();
  clearSignInMemory();
  setMe(null);
  navigate("/sign-in");
  await ending;
}

/** Honours `next` only when it is an address inside the app that belongs to this role. */
export function safeNext(next: string | null, role: Role): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  const owner = roleOfRoute(classifyRoute(next.split("?")[0] ?? "").kind);
  return owner === role ? next : null;
}
