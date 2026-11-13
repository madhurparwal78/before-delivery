import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure, type Account, type PublicConfig } from './api';
import { CompareScreen } from './pages/compare';
import { DesignerScreen } from './pages/designer';
import { FollowScreen } from './pages/follow';
import { HomeScreen } from './pages/home';
import { InviteScreen } from './pages/invite';
import { PublicScreen } from './pages/publicpage';
import { SettingsScreen } from './pages/settings';
import { SignInScreen, SignUpScreen, VerifyScreen } from './pages/accounts';
import { Shell } from './shell';

export type Layout = 'desktop' | 'tablet' | 'phone';

export interface LiveMessage {
  kind: string;
  [key: string]: unknown;
}

export type Route =
  | { name: 'home' }
  | { name: 'signup' }
  | { name: 'signin' }
  | { name: 'verify' }
  | { name: 'invite'; token: string }
  | { name: 'settings' }
  | { name: 'designer'; id: string }
  | { name: 'compare'; id: string }
  | { name: 'follow'; id: string }
  | { name: 'public'; id: string }
  | { name: 'notFound' };

function parseRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts.length === 1 && parts[0] === 'signup') return { name: 'signup' };
  if (parts.length === 1 && parts[0] === 'signin') return { name: 'signin' };
  if (parts.length === 1 && parts[0] === 'verify') return { name: 'verify' };
  if (parts.length === 1 && parts[0] === 'settings') return { name: 'settings' };
  if (parts.length === 2 && parts[0] === 'invite') return { name: 'invite', token: parts[1] };
  if (parts.length === 2 && parts[0] === 'patterns') return { name: 'designer', id: parts[1] };
  if (parts.length === 3 && parts[0] === 'patterns' && parts[2] === 'compare') {
    return { name: 'compare', id: parts[1] };
  }
  if (parts.length === 2 && parts[0] === 'follow') return { name: 'follow', id: parts[1] };
  if (parts.length === 2 && parts[0] === 'p') return { name: 'public', id: parts[1] };
  return { name: 'notFound' };
}

interface AppState {
  account: Account | null;
  setAccount: (account: Account | null) => void;
  config: PublicConfig | null;
  layout: Layout;
  reduceMotion: boolean;
  live: boolean;
  route: Route;
  path: string;
  query: URLSearchParams;
  navigate: (path: string, replace?: boolean) => void;
  subscribe: (handler: (message: LiveMessage) => void) => () => void;
  sendLive: (message: LiveMessage) => void;
  railOpen: boolean;
  toggleRail: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('app state is not ready');
  return state;
}

function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => measureLayout());
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const middle = window.matchMedia('(min-width: 600px)');
    const update = (): void => setLayout(measureLayout());
    wide.addEventListener('change', update);
    middle.addEventListener('change', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      wide.removeEventListener('change', update);
      middle.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.layout = layout;
  }, [layout]);
  return layout;
}

function measureLayout(): Layout {
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 600px)').matches) return 'tablet';
  return 'phone';
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [live, setLive] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const layout = useLayout();
  const systemReduced = useSystemReducedMotion();
  const handlers = useRef(new Set<(message: LiveMessage) => void>());
  const liveSocket = useRef<WebSocket | null>(null);

  const route = useMemo(() => parseRoute(path), [path]);
  const query = useMemo(() => new URLSearchParams(search), [search]);

  const navigate = useCallback((next: string, replace = false): void => {
    const url = new URL(next, window.location.origin);
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setPath(url.pathname);
    setSearch(url.search);
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api.get<PublicConfig>('/api/config'));
      } catch {
        setConfig(null);
      }
      try {
        setAccount(await api.get<Account>('/api/me'));
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) setAccount(null);
      }
      setReady(true);
    })();
  }, []);

  const socketPattern =
    route.name === 'designer' || route.name === 'compare'
      ? route.id
      : route.name === 'follow'
        ? route.id
        : null;

  useEffect(() => {
    if (!account) return undefined;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: number | null = null;
    const open = (): void => {
      const url = new URL('/ws', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (socketPattern) url.searchParams.set('pattern', socketPattern);
      socket = new WebSocket(url);
      liveSocket.current = socket;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as LiveMessage;
        if (message.kind === 'live') setLive(message.on === true);
        for (const handler of handlers.current) handler(message);
      };
      socket.onclose = () => {
        if (closed) return;
        retry = window.setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
    };
  }, [account, socketPattern]);

  const subscribe = useCallback((handler: (message: LiveMessage) => void): (() => void) => {
    handlers.current.add(handler);
    return () => handlers.current.delete(handler);
  }, []);

  const sendLive = useCallback((message: LiveMessage): void => {
    const socket = liveSocket.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const reduceMotion = systemReduced || account?.reduceMotion === true;

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? 'true' : 'false';
  }, [reduceMotion]);

  const state: AppState = {
    account,
    setAccount,
    config,
    layout,
    reduceMotion,
    live,
    route,
    path,
    query,
    navigate,
    subscribe,
    sendLive,
    railOpen,
    toggleRail: () => setRailOpen((open) => !open),
  };

  useEffect(() => {
    if (!ready) return;
    const needsAccount =
      route.name === 'home' ||
      route.name === 'settings' ||
      route.name === 'designer' ||
      route.name === 'compare' ||
      route.name === 'follow';
    if (!account && needsAccount) {
      navigate(`/signin?next=${encodeURIComponent(path + search)}`, true);
    }
  }, [ready, account, route.name, navigate, path, search]);

  return (
    <AppContext.Provider value={state}>
      {ready ? <Screen /> : <Shell lead="Loading..." />}
    </AppContext.Provider>
  );
}

function Screen(): JSX.Element {
  const { route, account } = useApp();
  switch (route.name) {
    case 'home':
      return account ? <HomeScreen /> : <Shell lead="Loading..." />;
    case 'signup':
      return <SignUpScreen />;
    case 'signin':
      return <SignInScreen />;
    case 'verify':
      return <VerifyScreen />;
    case 'invite':
      return <InviteScreen token={route.token} />;
    case 'settings':
      return account ? <SettingsScreen /> : <Shell lead="Loading..." />;
    case 'designer':
      return account ? <DesignerScreen id={route.id} /> : <Shell lead="Loading..." />;
    case 'compare':
      return account ? <CompareScreen id={route.id} /> : <Shell lead="Loading..." />;
    case 'follow':
      return account ? <FollowScreen id={route.id} /> : <Shell lead="Loading..." />;
    case 'public':
      return <PublicScreen id={route.id} />;
    case 'notFound':
      return (
        <Shell lead="This page is not here.">
          <h1>Not found.</h1>
        </Shell>
      );
  }
}
