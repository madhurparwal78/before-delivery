import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { quizmasterSchema, type Quizmaster } from "../../shared/schemas";
import { ApiFailure, api } from "./api";

type Session = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; quizmaster: Quizmaster };
type SessionApi = { session: Session; signedIn: (quizmaster: Quizmaster) => void; signOut: () => Promise<void> };

const SessionContext = createContext<SessionApi | null>(null);
const meSchema = z.object({ quizmaster: quizmasterSchema });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    api("/api/auth/me", { schema: meSchema }).then(
      ({ quizmaster }) => setSession({ status: "signedIn", quizmaster }),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) setSession({ status: "signedOut" });
      },
    );
  }, []);

  const signedIn = useCallback((quizmaster: Quizmaster) => setSession({ status: "signedIn", quizmaster }), []);
  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setSession({ status: "signedOut" });
  }, []);
  const value = useMemo(() => ({ session, signedIn, signOut }), [session, signedIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession needs a SessionProvider");
  return value;
}
