import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ClientConfig } from "../../shared/types";
import { api } from "./api";

const DEFAULTS: ClientConfig = { autosaveMs: 1500, blocksStepMs: 400, simTickMs: 100, toastMs: 4000, glancetFadeMs: 150 };
const ConfigContext = createContext<ClientConfig>(DEFAULTS);

/** Timer values come from the server (`GET /api/config`); nothing renders until they are known. */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  useEffect(() => {
    void api.get<ClientConfig>("/api/config").then(setConfig, () => setConfig(DEFAULTS));
  }, []);
  if (!config) return null;
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ClientConfig {
  return useContext(ConfigContext);
}
