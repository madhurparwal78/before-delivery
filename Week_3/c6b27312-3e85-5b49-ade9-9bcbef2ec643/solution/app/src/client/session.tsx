// Who is signed in, the public config, and whether part storage is reachable.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Config, Person } from "../shared/api";
import { api, get, onStorageOutage } from "./api";

interface Session {
  me: Person | null;
  config: Config | null;
  storageDown: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
}

const Context = createContext<Session>({ me: null, config: null, storageDown: false, ready: false, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Person | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [storageDown, setStorageDown] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const reply = await api<Person>("GET", "/api/me");
    setMe(reply.ok ? reply.data : null);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([refresh(), get<Config>("/api/config"), get<{ status: string; storage?: string }>("/api/health")]).then(([, cfg, health]) => {
      if (!live) return;
      setConfig(cfg.data);
      setStorageDown(health.data.storage === "down");
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  useEffect(() => onStorageOutage(() => setStorageDown(true)), []);

  const value = useMemo(() => ({ me, config, storageDown, ready, refresh }), [me, config, storageDown, ready, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): Session {
  return useContext(Context);
}

/** The public config. Every page except the home page renders only once the session is ready, so it is always present. */
export function useConfig(): Config {
  const { config } = useSession();
  if (!config) throw new Error("the config is read before the session is ready");
  return config;
}
