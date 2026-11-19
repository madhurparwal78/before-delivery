import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type UserInfo, get, post } from "./api.js";
import { navigate } from "./router.js";

type State = { status: "unknown" } | { status: "loading" } | { status: "out" } | { status: "in"; user: UserInfo };

interface Session {
  state: State;
  /** Looks the signed-in person up once; screens that need to know call this. */
  load: () => void;
  signedIn: (user: UserInfo) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<State>({ status: "unknown" });
  const load = useCallback(() => {
    setState((current) => {
      if (current.status !== "unknown") return current;
      get<{ user: UserInfo }>("/api/me").then(
        ({ user }) => setState({ status: "in", user }),
        () => setState({ status: "out" }),
      );
      return { status: "loading" };
    });
  }, []);
  const signedIn = useCallback((user: UserInfo) => setState({ status: "in", user }), []);
  const signOut = useCallback(async () => {
    await post("/api/auth/signout");
    setState({ status: "out" });
    navigate("/");
  }, []);
  const value = useMemo(() => ({ state, load, signedIn, signOut }), [state, load, signedIn, signOut]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession needs a SessionProvider");
  return session;
}

/** The session, looked up now (for screens that depend on who is signed in). */
export function useKnownSession(): Session {
  const session = useSession();
  const { load } = session;
  useEffect(load, [load]);
  return session;
}
