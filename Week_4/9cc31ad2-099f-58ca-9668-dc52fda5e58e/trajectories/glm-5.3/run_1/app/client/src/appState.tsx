// App-wide state: session, garage data, live pushes, outage banner.
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode, type JSX } from 'react';
import { api, type Me, type Garage } from './api';

export interface PushMessage {
  type: string;
  balance?: number;
  movementId?: string;
  purchaseId?: string | null;
  runId?: string;
  status?: string;
  layoutId?: string;
  mode?: string;
  class?: string;
  row?: unknown;
  leagues?: unknown;
  trophy?: boolean;
  lobby?: unknown;
}

interface AppCtx {
  me: Me | null;
  garage: Garage | null;
  refreshMe: () => Promise<void>;
  refreshGarage: () => Promise<void>;
  outage: boolean;
  push: PushMessage | null;
  wsOpen: boolean;
}

const Ctx = createContext<AppCtx>({
  me: null, garage: null, refreshMe: async () => {}, refreshGarage: async () => {},
  outage: false, push: null, wsOpen: false
});

export const useApp = (): AppCtx => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [garage, setGarage] = useState<Garage | null>(null);
  const [outage, setOutage] = useState(false);
  const [push, setPush] = useState<PushMessage | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pushListeners = useRef(new Set<(m: PushMessage) => void>());

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    }
  }, []);

  const refreshGarage = useCallback(async () => {
    try {
      setGarage(await api.garage());
    } catch {
      setGarage(null);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    void api.status().then(s => setOutage(s.replayStorage === 'unavailable')).catch(() => {});
    const t = setInterval(() => {
      void api.status().then(s => setOutage(s.replayStorage === 'unavailable')).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [refreshMe]);

  // The WebSocket: one per tab, opened when a session exists.
  useEffect(() => {
    if (me === null) return;
    let closed = false;
    let retry = 0;
    const open = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/v1/ws`);
      wsRef.current = ws;
      wsSend = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
      ws.onopen = () => { setWsOpen(true); retry = 0; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as PushMessage;
          setPush(msg);
          for (const l of pushListeners.current) l(msg);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setWsOpen(false);
        if (!closed) {
          retry = Math.min(retry + 1, 6);
          setTimeout(open, Math.min(500 * 2 ** retry, 5000));
        }
      };
    };
    open();
    return () => { closed = true; wsRef.current?.close(); };
  }, [me !== null]);

  // Balance pushes update the garage's balance.
  useEffect(() => {
    if (push?.type === 'balance' && garage) {
      // The garage screen handles its own held pushes; this is the default.
      setGarage({ ...garage, balance: push.balance ?? garage.balance });
    }
  }, [push]);

  return (
    <Ctx.Provider value={{ me, garage, refreshMe, refreshGarage, outage, push, wsOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePush(handler: (m: PushMessage) => void): void {
  const { push } = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (push) ref.current(push);
  }, [push]);
}

let wsSend: ((msg: unknown) => void) | null = null;

export function sendWs(message: unknown): void {
  wsSend?.(message);
}
