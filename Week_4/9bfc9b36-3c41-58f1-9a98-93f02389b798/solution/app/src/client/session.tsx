/** Who is signed in. The bearer token lives in memory; the cookie only lets a reload ask for a fresh one. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, refreshSession, sendJson, setAccessToken, setSessionLostHandler } from "./api.js";
import { useLive } from "./live.js";
import { useRouter } from "./router.js";
import type { Account, Role, SessionBody } from "../shared/types.js";

interface SessionValue {
  account: Account | null;
  /** True until the first answer about the cookie has arrived. */
  checking: boolean;
  signIn: (email: string, password: string) => Promise<Account>;
  signOut: () => void;
  /** Wipes everything a page of the previous account could still be holding. */
  epoch: number;
}

const SessionContext = createContext<SessionValue | null>(null);

export const HOME: Record<Role, string> = { sailmaker: "/loft", "loft-hand": "/floor", "yacht-owner": "/owner" };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const { location, navigate } = useRouter();
  const { refuse } = useLive();
  const location_ = useRef(location);
  location_.current = location;

  useEffect(() => {
    let live = true;
    // the readable hint travels with the session cookie: without it there is no session to refresh
    const hinted = document.cookie.split(";").some((part) => part.trim().startsWith("boltrope_signed="));
    (hinted ? refreshSession() : Promise.resolve(null))
      .catch(() => null)
      .then((body) => {
        if (!live) return;
        setAccount(body?.account ?? null);
        setChecking(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      const here = location_.current;
      setAccessToken(null);
      setAccount(null);
      setEpoch((value) => value + 1);
      navigate(`/signin?resume=${encodeURIComponent(here.path + here.search)}`, { replace: true, state: { ended: true } });
    });
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await sendJson<SessionBody>("POST", "/api/session", { email, password });
    setAccessToken(data.access_token);
    setAccount(data.account);
    return data.account;
  }, []);

  const signOut = useCallback(() => {
    void sendJson("DELETE", "/api/session").catch((error: unknown) => {
      if (!(error instanceof ApiError)) throw error;
    });
    setAccessToken(null);
    setAccount(null);
    setEpoch((value) => value + 1);
    refuse(null);
    navigate("/");
  }, [navigate, refuse]);

  const value = useMemo(() => ({ account, checking, signIn, signOut, epoch }), [account, checking, signIn, signOut, epoch]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session is missing");
  return value;
}

/** The signed-in account; only used below the route guard, where one always exists. */
export function useAccount(): Account {
  const { account } = useSession();
  if (!account) throw new Error("No account");
  return account;
}
