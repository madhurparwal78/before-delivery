import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account, SessionView } from "../../shared/types";
import { copy } from "../../shared/copy";
import { api, ApiError } from "./api";
import { useNotices } from "./notices";
import { useStatus } from "./status";

interface SessionValue {
  /** null until the first `/api/session` answer. */
  loaded: boolean;
  account: Account | null;
  pendingJoin: SessionView["pendingJoin"];
  /** The newest live-stream event when the session was read; the stream replays anything after it. */
  streamSequence: number;
  setAccount: (account: Account | null) => void;
  refresh: () => Promise<Account | null>;
  resendVerification: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const VERIFY_NOTICE_ID = "verify-reminder";

export function SessionProvider({ children }: { children: ReactNode }) {
  const { announce } = useStatus();
  const { setNotice, clearNotice } = useNotices();
  const [view, setView] = useState<SessionView & { loaded: boolean }>({ loaded: false, account: null, pendingJoin: null, streamSequence: 0 });
  const resendRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    const next = await api.get<SessionView>("/api/session");
    setView({ loaded: true, ...next });
    return next.account;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setAccount = useCallback((account: Account | null) => {
    setView((current) => ({ loaded: true, account, pendingJoin: null, streamSequence: current.streamSequence }));
  }, []);

  const resendVerification = useCallback(async () => {
    try {
      const sent = await api.post<{ sentTo: string }>("/api/auth/resend-verification");
      announce(copy.verificationSent(sent.sentTo));
    } catch (error) {
      if (error instanceof ApiError) {
        announce(error.message);
        if (error.code === "already_verified") await refresh();
        if (error.code === "mail_unavailable") setNotice({ id: "mail-unavailable", message: error.message });
      }
    }
  }, [announce, refresh, setNotice]);
  resendRef.current = resendVerification;

  const { account } = view;
  const unverified = account !== null && account.kind !== "student" && !account.emailVerified;
  const email = account?.email ?? "";
  useEffect(() => {
    if (unverified) {
      setNotice({ id: VERIFY_NOTICE_ID, message: copy.unverifiedReminder(email), actions: [{ label: "Resend verification email", onClick: () => void resendRef.current() }] });
    } else {
      clearNotice(VERIFY_NOTICE_ID);
    }
  }, [unverified, email, setNotice, clearNotice]);

  const value = useMemo(() => ({ ...view, setAccount, refresh, resendVerification }), [view, setAccount, refresh, resendVerification]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

export function homePath(account: Account): string {
  if (account.kind === "educator") return "/dashboard";
  return account.kind === "student" ? "/class" : "/projects";
}
