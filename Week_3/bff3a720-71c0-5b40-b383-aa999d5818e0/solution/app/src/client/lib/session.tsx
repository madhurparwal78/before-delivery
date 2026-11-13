import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { CitiesReply, Member } from "../../shared/api";
import { api } from "./http";
import { navigate } from "./router";

interface Session {
  member: Member | null;
  ready: boolean;
  /** The server's date and time when the page loaded; never the device clock. */
  serverNow: Date;
  signedIn: (member: Member) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [member, setMember] = useState<Member | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const [asked, setAsked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMember(await api<Member>("GET", "/api/me"));
    } catch {
      setMember(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [, cities] = await Promise.all([refresh(), api<CitiesReply>("GET", "/api/cities")]);
      setServerNow(new Date(cities.server_now));
      setAsked(true);
    })();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api<void>("POST", "/api/auth/sign-out");
    setMember(null);
    navigate("/");
  }, []);

  const value = useMemo<Session | null>(
    () =>
      asked && serverNow
        ? { member, ready: true, serverNow, signedIn: setMember, signOut, refresh }
        : null,
    [asked, member, serverNow, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null until the first load of the member and the server date has finished. */
export function useSessionOrNull(): Session | null {
  return useContext(Ctx);
}

export function useSession(): Session {
  const value = useContext(Ctx);
  if (!value) throw new Error("session not ready");
  return value;
}
