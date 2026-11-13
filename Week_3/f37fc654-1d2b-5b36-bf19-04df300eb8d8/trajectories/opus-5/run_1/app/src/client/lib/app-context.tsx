import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SignedOut, api, onSignedOut } from './api.js';
import { DEFAULT_STAGE, type StageState } from '../stage/renderer.js';
import { OUTAGE_BANNERS, type ServiceName } from '../../shared/copy.js';
import type { AppRole } from '../../shared/seed.js';

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: AppRole[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  signedOut: boolean;
  reload: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  me: null,
  loading: true,
  signedOut: false,
  reload: () => undefined,
  signOut: async () => undefined,
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

interface StageValue {
  state: StageState;
  patch: (next: Partial<StageState>) => void;
}

const StageContext = createContext<StageValue>({
  state: DEFAULT_STAGE,
  patch: () => undefined,
});

export function useStage(): StageValue {
  return useContext(StageContext);
}

/** Set the stage for a route, and leave it as it was on the way out. */
export function useStageScene(next: Partial<StageState>): void {
  const { patch } = useStage();
  const key = JSON.stringify(next);
  useEffect(() => {
    patch(JSON.parse(key) as Partial<StageState>);
  }, [key, patch]);
}

interface ToastsValue {
  toasts: { id: number; text: string }[];
  notify: (text: string) => void;
}

const ToastsContext = createContext<ToastsValue>({ toasts: [], notify: () => undefined });

export function useToasts(): ToastsValue {
  return useContext(ToastsContext);
}

interface StatusValue {
  banners: { service: ServiceName; text: string }[];
  down: Set<ServiceName>;
}

const StatusContext = createContext<StatusValue>({ banners: [], down: new Set() });

export function useServiceStatus(): StatusValue {
  return useContext(StatusContext);
}

export type AppEventName =
  | 'commission.updated'
  | 'payment.confirmed'
  | 'render.updated'
  | 'job.updated'
  | 'hold.updated';

type EventHandler = (data: Record<string, unknown>) => void;

const EventsContext = createContext<(name: AppEventName, handler: EventHandler) => () => void>(
  () => () => undefined,
);

/** Listen to one kind of live event for as long as the screen is open. */
export function useAppEvent(name: AppEventName, handler: EventHandler): void {
  const subscribe = useContext(EventsContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => subscribe(name, (data) => ref.current(data)),
    [name, subscribe],
  );
}

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [stage, setStage] = useState<StageState>(DEFAULT_STAGE);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [down, setDown] = useState<Set<ServiceName>>(new Set());
  const handlers = useRef(new Map<AppEventName, Set<EventHandler>>());

  const loadMe = useCallback(() => {
    setLoading(true);
    api
      .get<Me>('/api/me')
      .then((value) => {
        setMe(value);
        setSignedOut(false);
      })
      .catch((error: unknown) => {
        if (error instanceof SignedOut) setSignedOut(true);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadMe, [loadMe]);
  useEffect(() => onSignedOut(() => setSignedOut(true)), []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setMe(null);
  }, []);

  const patch = useCallback((next: Partial<StageState>) => {
    setStage((current) => ({ ...current, ...next }));
  }, []);

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text }]);
    // Each toast stays 6 seconds.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6_000);
  }, []);

  // A banner appears within 15 seconds of its service becoming unreachable.
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const report = await api.get<{ services: Record<ServiceName, 'up' | 'down'> }>(
          '/api/status',
        );
        if (cancelled) return;
        const next = new Set<ServiceName>();
        for (const [service, status] of Object.entries(report.services)) {
          if (status === 'down') next.add(service as ServiceName);
        }
        setDown(next);
      } catch {
        // Leave the last known picture in place.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 7_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // The live stream of confirmed payments, state changes, renders and jobs.
  useEffect(() => {
    if (!me) return undefined;
    const source = new EventSource('/api/events', { withCredentials: true });
    const names: AppEventName[] = [
      'commission.updated', 'payment.confirmed', 'render.updated', 'job.updated', 'hold.updated',
    ];
    const listeners = names.map((name) => {
      const listener = (event: MessageEvent<string>): void => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        for (const handler of handlers.current.get(name) ?? []) handler(data);
      };
      source.addEventListener(name, listener as EventListener);
      return { name, listener };
    });
    return () => {
      for (const entry of listeners) {
        source.removeEventListener(entry.name, entry.listener as EventListener);
      }
      source.close();
    };
  }, [me]);

  const subscribe = useCallback((name: AppEventName, handler: EventHandler) => {
    const set = handlers.current.get(name) ?? new Set<EventHandler>();
    set.add(handler);
    handlers.current.set(name, set);
    return () => {
      set.delete(handler);
    };
  }, []);

  const banners = useMemo(
    () =>
      [...down]
        .sort()
        .map((service) => ({ service, text: OUTAGE_BANNERS[service] })),
    [down],
  );

  const sessionValue = useMemo<SessionValue>(
    () => ({ me, loading, signedOut, reload: loadMe, signOut }),
    [me, loading, signedOut, loadMe, signOut],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <StageContext.Provider value={useMemo(() => ({ state: stage, patch }), [stage, patch])}>
        <StatusContext.Provider value={useMemo(() => ({ banners, down }), [banners, down])}>
          <ToastsContext.Provider value={useMemo(() => ({ toasts, notify }), [toasts, notify])}>
            <EventsContext.Provider value={subscribe}>{children}</EventsContext.Provider>
          </ToastsContext.Provider>
        </StatusContext.Provider>
      </StageContext.Provider>
    </SessionContext.Provider>
  );
}

