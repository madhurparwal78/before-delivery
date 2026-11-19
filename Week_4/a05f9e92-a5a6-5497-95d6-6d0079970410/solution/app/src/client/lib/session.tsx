import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionUser } from "../../shared/types.js";
import { del, get, whenUnauthenticated } from "./api.js";
import { useAnnounce } from "./announce.js";
import { navigate } from "./router.js";
import { useTopics } from "./live.js";

interface SessionState {
  status: "loading" | "anonymous" | "ready";
  user: SessionUser | null;
  workspace: "live" | "test";
  impersonating: { username: string; display_name: string } | null;
  /** Bumps whenever roles or access rules changed, so open screens can load again. */
  accessVersion: number;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  isDesk: boolean;
  isOperator: boolean;
}

const Context = createContext<SessionState | null>(null);

export interface Loaded {
  user: SessionUser;
  workspace: "live" | "test";
  impersonating: { username: string; display_name: string } | null;
}

/** `initial` is the session as the first request found it: a person, null for nobody, or undefined while it is still unknown. */
export function SessionProvider({ children, initial }: { children: ReactNode; initial?: Loaded | null }): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(initial);
  const [accessVersion, setAccessVersion] = useState(0);
  const announce = useAnnounce();

  const refresh = useCallback(async () => {
    try {
      setLoaded(await get<Loaded>("/api/session"));
    } catch {
      setLoaded(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    whenUnauthenticated(() => {
      setLoaded(null);
      navigate("/login");
    });
  }, [refresh]);

  useTopics(loaded ? ["session"] : [], (message) => {
    if (message.event === "access_changed") announce("Your access changed.");
    void refresh().then(() => setAccessVersion((v) => v + 1));
  });

  const signOut = useCallback(async () => {
    await del("/api/session").catch(() => undefined);
    setLoaded(null);
    navigate("/");
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      status: loaded === undefined ? "loading" : loaded === null ? "anonymous" : "ready",
      user: loaded?.user ?? null,
      workspace: loaded?.workspace ?? "live",
      impersonating: loaded?.impersonating ?? null,
      accessVersion,
      refresh,
      signOut,
      isDesk: !!loaded && (loaded.user.roles.includes("operator") || loaded.user.roles.includes("technician")),
      isOperator: !!loaded && loaded.user.roles.includes("operator"),
    }),
    [loaded, accessVersion, refresh, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(Context);
  if (!value) throw new Error("useSession needs a SessionProvider");
  return value;
}
