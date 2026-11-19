// App state: the signed-in person, their workspaces and the session bootstrap.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getJson, type User, type WorkspaceRef } from "./api.js";

export interface Bootstrap {
  squareRowRevealMs: number;
  timeZone: string;
}

interface AppState {
  user: User | null;
  workspaces: WorkspaceRef[];
  bootstrap: Bootstrap;
  reload: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const FALLBACK_BOOTSTRAP: Bootstrap = { squareRowRevealMs: 100, timeZone: "Europe/Berlin" };

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [bootstrap, setBootstrap] = useState<Bootstrap>(FALLBACK_BOOTSTRAP);
  const [, setReady] = useState(false);

  const reload = async () => {
    try {
      const body = await getJson<{ user: User; workspaces: WorkspaceRef[] }>("/api/me");
      setUser(body.user);
      setWorkspaces(body.workspaces);
    } catch {
      setUser(null);
      setWorkspaces([]);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const config = await getJson<Bootstrap>("/api/bootstrap");
        setBootstrap(config);
      } catch {
        setBootstrap(FALLBACK_BOOTSTRAP);
      }
      await reload();
    })();
  }, []);

  const value = useMemo(
    () => ({ user, workspaces, bootstrap, reload: () => reload() }),
    [user, workspaces, bootstrap],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp outside provider");
  return context;
}
