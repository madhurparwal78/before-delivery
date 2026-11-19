import { useEffect, useState, useRef } from 'react';
import type { Config } from './types.js';
import { loadConfig } from './api.js';

type AppContextValue = {
  config: Config | null;
  me: { id: string; handle: string; name: string } | null;
  businessNow: () => Date;
  signedIn: boolean;
  refreshMe: () => Promise<void>;
  route: { path: string; params: Record<string, string> };
  navigate: (path: string) => void;
  unreadCounts: { messages: number; notifications: number; invitations: number };
  setUnreadCounts: (counts: Partial<{ messages: number; notifications: number; invitations: number }>) => void;
  liveEvents: LiveBus;
  announce: (region: string, text: string) => void;
  reduceMotion: boolean;
};

export type LiveBus = {
  subscribe: (handler: (event: string, data: unknown) => void) => () => void;
};

import { createContext, useContext } from 'react';

const AppContext = createContext<AppContextValue | null>(null);

export const useApp = (): AppContextValue => {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside provider');
  return value;
};

export const AppProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const [config, setConfig] = useState<Config | null>(null);
  const [me, setMe] = useState<{ id: string; handle: string; name: string } | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [route, setRoute] = useState(parseLocation());
  const [unreadCounts, setUnreadCountsState] = useState({ messages: 0, notifications: 0, invitations: 0 });
  const [serverEpoch, setServerEpoch] = useState<{ at: number; instant: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(new Set<(event: string, data: unknown) => void>());

  const liveBus: LiveBus = {
    subscribe: (handler) => {
      handlersRef.current.add(handler);
      return () => { handlersRef.current.delete(handler); };
    },
  };

  const refreshMe = async (): Promise<void> => {
    try {
      const profile = await (await import('./api.js')).api.get<{ id: string; handle: string; name: string } & Record<string, unknown>>('/api/me');
      setMe({ id: profile.id, handle: profile.handle, name: profile.name });
      setSignedIn(true);
    } catch {
      setMe(null);
      setSignedIn(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const c = await loadConfig();
      setConfig(c);
      setServerEpoch({ at: Date.now(), instant: Date.parse(c.now) });
      await refreshMe();
    })();
  }, []);

  useEffect(() => {
    const onPop = (): void => setRoute(parseLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (path: string): void => {
    window.history.pushState({}, '', path);
    setRoute(parseLocation());
  };

  useEffect(() => {
    if (!signedIn) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource('/api/live');
    esRef.current = es;
    es.addEventListener('ready', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { now: string };
      setServerEpoch({ at: Date.now(), instant: Date.parse(data.now) });
    });
    es.addEventListener('clock', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { now: string };
      setServerEpoch({ at: Date.now(), instant: Date.parse(data.now) });
      for (const handler of handlersRef.current) handler('clock', data);
    });
    for (const name of ['connection', 'blocked', 'blocked_by', 'message', 'typing', 'read', 'notification',
      'post_update', 'profile_update', 'application_update', 'editor_presence', 'editor_typing', 'job_update']) {
      es.addEventListener(name, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        for (const handler of handlersRef.current) handler(name, data);
      });
    }
    return () => { es.close(); esRef.current = null; };
  }, [signedIn]);

  // Business clock: server instant advanced by elapsed real time, never the device date.
  const businessNow = (): Date => {
    if (serverEpoch) return new Date(serverEpoch.instant + (Date.now() - serverEpoch.at));
    return config ? new Date(Date.parse(config.now)) : new Date();
  };

  const setUnreadCounts = (counts: Partial<{ messages: number; notifications: number; invitations: number }>): void => {
    setUnreadCountsState((prev) => ({ ...prev, ...counts }));
  };

  const [announceState, setAnnounceState] = useState<Record<string, string>>({});
  const announce = (region: string, text: string): void => {
    setAnnounceState((prev) => ({ ...prev, [region]: `${text}\u200b`.repeat(1) + (prev[region] === text ? ' ' : '') }));
  };
  void announceState;

  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const value: AppContextValue = {
    config, me, businessNow, signedIn, refreshMe, route, navigate,
    unreadCounts, setUnreadCounts, liveEvents: liveBus, announce, reduceMotion,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

function parseLocation(): { path: string; params: Record<string, string> } {
  const url = new URL(window.location.pathname + window.location.search, window.location.origin);
  return { path: url.pathname, params: Object.fromEntries(url.searchParams.entries()) };
}
