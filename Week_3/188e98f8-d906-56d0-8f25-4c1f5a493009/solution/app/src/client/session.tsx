import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SessionInfo } from "../shared/api-types";
import { deskPath } from "../shared/roles";
import { Unreachable, get, post, request, whenSignedOut } from "./api";
import { COPY } from "./copy";
import { useMessages } from "./messages";
import { navigate } from "./router";

type State = { status: "loading" } | { status: "out" } | { status: "in"; info: SessionInfo };

interface SessionApi {
  state: State;
  signIn: (code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** The team name the session was opened with is stale after a rename; callers read the table instead. */
}

const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("SessionProvider is missing");
  return session;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const messages = useMessages();
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    whenSignedOut(() => {
      if (current.current.status !== "in") return;
      setState({ status: "out" });
      navigate("/sign-in");
      messages.say(COPY.signedOut, "error");
    });
  }, [messages]);

  useEffect(() => {
    void get<SessionInfo>("/api/session", { answers401: true })
      .then((reply) => setState(reply.ok ? { status: "in", info: reply.data } : { status: "out" }))
      .catch(() => setState({ status: "out" }));
  }, []);

  const signIn = useCallback(
    async (code: string) => {
      messages.pending(COPY.checkingCode);
      try {
        const reply = await post<SessionInfo>("/api/session", { code }, { answers401: true });
        if (!reply.ok) {
          messages.say(COPY.badCode, "error");
          return false;
        }
        messages.clear();
        setState({ status: "in", info: reply.data });
        navigate(deskPath(reply.data.role));
        return true;
      } catch (error) {
        if (!(error instanceof Unreachable)) throw error;
        messages.say(COPY.unreachable, "error");
        return false;
      }
    },
    [messages],
  );

  const signOut = useCallback(async () => {
    await request("DELETE", "/api/session", { answers401: true }).catch(() => undefined);
    setState({ status: "out" });
    messages.clear();
    navigate("/sign-in");
  }, [messages]);

  const value = useMemo(
    () => ({ state, signIn, signOut }),
    [state, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
