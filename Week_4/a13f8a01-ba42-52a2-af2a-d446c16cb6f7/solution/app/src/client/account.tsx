import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "../shared/types.js";
import { api, messageOf } from "./api.js";
import { useLive } from "./live.js";
import { navigate } from "./router.js";

type Verification = "sent" | "pending" | null;

interface Account {
  ready: boolean;
  user: User | null;
  verification: Verification;
  message: string;
  refresh: () => Promise<void>;
  resend: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (account === null) throw new Error("useAccount needs an AccountProvider");
  return account;
}

export function AccountProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [verification, setVerification] = useState<Verification>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const answer = await api.get<{ user: User; verification?: Verification }>("/api/me");
      setUser(answer.user);
      setVerification(answer.verification ?? null);
    } catch {
      setUser(null);
      setVerification(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only an unverified account waits for the verification event; a stream with nothing to say is not opened.
  useLive(
    [],
    {
      account: () => {
        setUser((current) => (current && !current.verified ? { ...current, verified: true } : current));
        setVerification(null);
        setMessage("Email verified. You can now save versions.");
      },
    },
    user !== null && !user.verified,
  );

  const resend = useCallback(async (): Promise<void> => {
    try {
      await api.post("/api/verify/resend");
      setVerification("sent");
      setMessage(`Sent a new link to ${user?.email ?? ""}.`);
    } catch (error) {
      setMessage(messageOf(error));
    }
  }, [user]);

  const signOut = useCallback(async (): Promise<void> => {
    await api.post("/api/signout");
    setUser(null);
    setVerification(null);
    setMessage("");
    navigate("/");
  }, []);

  const value = useMemo(
    () => ({ ready, user, verification, message, refresh, resend, signOut }),
    [ready, user, verification, message, refresh, resend, signOut],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
