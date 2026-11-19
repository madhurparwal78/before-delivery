import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useLive } from './live';
import type { Config } from './types';

/** The server's instant at the moment it was received, with the page's own monotonic reading at that moment. */
let baseline = { serverMs: 0, perfMs: 0 };

function adopt(iso: string): void {
  baseline = { serverMs: new Date(iso).getTime(), perfMs: performance.now() };
}

/** The business clock's current instant in epoch milliseconds: the server's instant plus elapsed page time. */
function serverNowMs(): number {
  return baseline.serverMs + (performance.now() - baseline.perfMs);
}

const ConfigContext = createContext<Config | null>(null);
const NowContext = createContext<number>(0);

const TICK_MS = 1000;

/** Loads `GET /api/config`, keeps the business clock, and re-renders `useNow()` users every second and on every clock move. */
export function ClockProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    void api.get<Config>('/api/config').then((loaded) => {
      adopt(loaded.now);
      setConfig(loaded);
      setNow(Math.floor(serverNowMs()));
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(serverNowMs())), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useLive('clock', (event) => {
    adopt(event.now);
    setNow(Math.floor(serverNowMs()));
  });

  if (!config) return null;
  return (
    <ConfigContext.Provider value={config}>
      <NowContext.Provider value={now}>{children}</NowContext.Provider>
    </ConfigContext.Provider>
  );
}

/** ClockProvider renders its children only once the config has loaded, so every caller has it. */
export const useConfig = (): Config => useContext(ConfigContext) as Config;

/** The business clock in epoch milliseconds, refreshed each second and at once on a clock move. */
export const useNow = (): number => useContext(NowContext);
