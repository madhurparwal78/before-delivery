import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CurrentGameweek,
  DraftView,
  EventType,
  Me,
  Notice,
  NoticesView,
  SquadView,
} from '../shared/types.ts';
import { api, RequestFailed } from './api.ts';

export interface PointsUpdate {
  type: 'points';
  event_id: string;
  player_id: string;
  player_name: string;
  event_type: EventType;
  voided: boolean;
  counts: boolean;
  team_delta: number;
  player_team_points: number;
  gameweek_total: number;
  multiplier: number;
}

type ServerMessage =
  | { type: 'gameweek'; gameweek: CurrentGameweek }
  | { type: 'squad' }
  | { type: 'standings' }
  | { type: 'notice'; notice: Notice; unread: number }
  | PointsUpdate;

interface AppStateValue {
  ready: boolean;
  me: Me | null;
  gameweek: CurrentGameweek | null;
  squad: SquadView | null;
  hasSquad: boolean;
  squadLoaded: boolean;
  draft: DraftView | null;
  notices: NoticesView | null;
  noticesOutage: boolean;
  setMe: (me: Me | null) => void;
  refreshSquad: () => Promise<void>;
  refreshDraft: () => Promise<void>;
  refreshNotices: () => Promise<void>;
  onPoints: (listener: (update: PointsUpdate) => void) => () => void;
  onStandings: (listener: () => void) => () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export const AppStateProvider = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [gameweek, setGameweek] = useState<CurrentGameweek | null>(null);
  const [squad, setSquad] = useState<SquadView | null>(null);
  const [hasSquad, setHasSquad] = useState(false);
  const [squadLoaded, setSquadLoaded] = useState(false);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [notices, setNotices] = useState<NoticesView | null>(null);
  const [noticesOutage, setNoticesOutage] = useState(false);

  const pointsListeners = useRef(new Set<(update: PointsUpdate) => void>());
  const standingsListeners = useRef(new Set<() => void>());

  const refreshSquad = useCallback(async () => {
    try {
      const view = await api.squad();
      setSquad(view);
      setHasSquad(true);
      setSquadLoaded(true);
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'no_squad') {
        setSquad(null);
        setHasSquad(false);
        setSquadLoaded(true);
        return;
      }
      throw error;
    }
  }, []);

  const refreshDraft = useCallback(async () => {
    setDraft(await api.draft());
  }, []);

  const refreshNotices = useCallback(async () => {
    try {
      setNotices(await api.notices());
      setNoticesOutage(false);
    } catch (error) {
      if (error instanceof RequestFailed && error.status === 503) {
        setNoticesOutage(true);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const account = await api.me();
        setMe(account);
      } catch {
        setMe(null);
      }
      setReady(true);
    };
    void load();
  }, []);

  useEffect(() => {
    if (me === null) {
      setGameweek(null);
      setSquad(null);
      setDraft(null);
      setNotices(null);
      return;
    }
    const load = async (): Promise<void> => {
      setGameweek(await api.currentGameweek());
      if (me.role === 'manager') {
        await refreshSquad();
        await refreshDraft();
      }
      await refreshNotices();
    };
    void load();
  }, [me, refreshSquad, refreshDraft, refreshNotices]);

  useEffect(() => {
    if (me === null) return;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let closed = false;

    const connect = (): void => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/live`);
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'gameweek') setGameweek(message.gameweek);
        if (message.type === 'squad') {
          if (me.role === 'manager') {
            void refreshSquad();
            void refreshDraft();
          }
          for (const listener of standingsListeners.current) listener();
        }
        if (message.type === 'standings') {
          for (const listener of standingsListeners.current) listener();
        }
        if (message.type === 'notice') {
          setNotices((current) => ({
            unread: message.unread,
            notices: [message.notice, ...(current?.notices ?? [])],
          }));
          setNoticesOutage(false);
        }
        if (message.type === 'points') {
          for (const listener of pointsListeners.current) listener(message);
        }
      };
      socket.onclose = () => {
        if (closed) return;
        timer = window.setTimeout(connect, 1000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      socket?.close();
    };
  }, [me, refreshSquad, refreshDraft]);

  const onPoints = useCallback((listener: (update: PointsUpdate) => void) => {
    pointsListeners.current.add(listener);
    return () => {
      pointsListeners.current.delete(listener);
    };
  }, []);

  const onStandings = useCallback((listener: () => void) => {
    standingsListeners.current.add(listener);
    return () => {
      standingsListeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      me,
      gameweek,
      squad,
      hasSquad,
      squadLoaded,
      draft,
      notices,
      noticesOutage,
      setMe,
      refreshSquad,
      refreshDraft,
      refreshNotices,
      onPoints,
      onStandings,
    }),
    [
      ready,
      me,
      gameweek,
      squad,
      hasSquad,
      squadLoaded,
      draft,
      notices,
      noticesOutage,
      refreshSquad,
      refreshDraft,
      refreshNotices,
      onPoints,
      onStandings,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export const useApp = (): AppStateValue => {
  const context = useContext(AppStateContext);
  if (context === null) throw new Error('App state is not mounted');
  return context;
};

export const useReducedMotion = (): boolean => {
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
};
