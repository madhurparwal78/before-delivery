import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiFailure, bindSession, get, post } from "./api";
import type { Account } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  account: Account | null;
  balancePaise: number;
  reload: () => Promise<void>;
  signedIn: (account: Account) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

/** Only these paths may be the landing page after sign-in: a single leading slash and no scheme. */
export function safeNext(next: string | null): string | null {
  if (next === null || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

export function signInHref(path: string): string {
  return `/signin?next=${encodeURIComponent(path)}`;
}

interface Boot {
  account?: Account;
  balance_paise?: number;
  guest?: boolean;
}

/** The server tells the page who is visiting, so a stranger never causes a failing `/api/me` call. */
function readBoot(): Boot {
  try {
    return JSON.parse(document.getElementById("boot")?.textContent ?? "{}") as Boot;
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const boot = useRef(readBoot()).current;
  const [status, setStatus] = useState<Status>(boot.account ? "signedIn" : boot.guest ? "signedOut" : "loading");
  const [account, setAccount] = useState<Account | null>(boot.account ?? null);
  const [balancePaise, setBalance] = useState(boot.balance_paise ?? 0);
  const navigate = useNavigate();
  const signedInRef = useRef(boot.account !== undefined);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const me = await get<{ account: Account; balance_paise: number }>("/api/me");
      signedInRef.current = true;
      setAccount(me.account);
      setBalance(me.balance_paise);
      setStatus("signedIn");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      signedInRef.current = false;
      setAccount(null);
      setBalance(0);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    bindSession(
      () => signedInRef.current,
      () => {
        signedInRef.current = false;
        setAccount(null);
        setStatus("signedOut");
        const here = `${window.location.pathname}${window.location.search}`;
        navigate(signInHref(here), { state: { reason: "signed_out" } });
      },
    );
    if (!boot.account && !boot.guest) void reload();
  }, [boot, navigate, reload]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      account,
      balancePaise,
      reload,
      signedIn: async (next) => {
        signedInRef.current = true;
        setAccount(next);
        setStatus("signedIn");
        await reload();
      },
      signOut: async () => {
        await post("/api/auth/signout", {});
        signedInRef.current = false;
        setAccount(null);
        setBalance(0);
        setStatus("signedOut");
      },
    }),
    [status, account, balancePaise, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
