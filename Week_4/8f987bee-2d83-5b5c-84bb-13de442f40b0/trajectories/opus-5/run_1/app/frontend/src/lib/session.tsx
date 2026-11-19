import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, onUnauthenticated, readToken, writeToken } from "./api";
import { discardDraft } from "./draft";

export interface Preferences {
  sync_sounds: boolean;
  theme: "light" | "dark";
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  workspace_id: string;
  preferences: Preferences;
}

interface Session {
  user: User | null;
  loading: boolean;
  signedIn: boolean;
  refresh: () => Promise<User | null>;
  signIn: (token: string, user: User) => void;
  signOut: () => Promise<void>;
  setPreferences: (preferences: Preferences) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const place = useRef(location);
  place.current = location;

  useEffect(() => {
    onUnauthenticated(() => {
      writeToken(null);
      setUser(null);
      const here = `${place.current.pathname}${place.current.search}`;
      if (here.startsWith("/app")) {
        navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
      }
    });
  }, [navigate]);

  const refresh = useCallback(async () => {
    if (!readToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const answer = await api<{ user: User }>("GET", "/api/me");
      setUser(answer.user);
      return answer.user;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: Session = {
    user,
    loading,
    signedIn: user !== null,
    refresh,
    signIn: (token, nextUser) => {
      const previous = user?.id;
      writeToken(token);
      if (previous !== undefined && previous !== nextUser.id) discardDraft();
      setUser(nextUser);
      setLoading(false);
    },
    signOut: async () => {
      try {
        await api<void>("POST", "/api/auth/logout", { body: {} });
      } catch {
        /* the token is dropped either way */
      }
      writeToken(null);
      discardDraft();
      setUser(null);
    },
    setPreferences: (preferences) => setUser((held) => (held ? { ...held, preferences } : held)),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession outside SessionProvider");
  return session;
}

export function mayOpen(role: User["role"] | null, path: string): boolean {
  if (role === null) return false;
  if (path === "/app/members" || path === "/app/audit") return role === "admin";
  if (path === "/app/connections/new") return role === "admin" || role === "editor";
  return true;
}

export const CONSOLE_PAGES: { path: string; label: string }[] = [
  { path: "/app", label: "Connections" },
  { path: "/app/sources", label: "Sources" },
  { path: "/app/destinations", label: "Destinations" },
  { path: "/app/builder", label: "Builder" },
  { path: "/app/members", label: "Members" },
  { path: "/app/audit", label: "Audit log" },
  { path: "/app/settings", label: "Settings" },
];
