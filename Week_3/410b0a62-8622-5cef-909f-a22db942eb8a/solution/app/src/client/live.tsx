import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChangeEvent, NoticeEvent } from '../shared/types.js';
import { useSession } from './session.js';

interface Notice {
  id: number;
  text: string;
}

type ChangeListener = (event: ChangeEvent | null) => void;

interface Live {
  notices: Notice[];
  pushNotice: (text: string) => void;
  clearNotices: () => void;
  /** Called on every committed change the user may see; `null` means the stream (re)opened and anything may have changed. */
  subscribe: (listener: ChangeListener) => () => void;
}

const LiveContext = createContext<Live | null>(null);
const KEPT_NOTICES = 4;
const STREAM_DELAY_MS = 1500;
// The server's notice cursor when this page loaded: the stream opens late, so it asks for the notices since then.
const LOAD_CURSOR = document.querySelector<HTMLMetaElement>('meta[name="live-cursor"]')?.content ?? '';

export function LiveProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [notices, setNotices] = useState<Notice[]>([]);
  const listeners = useRef(new Set<ChangeListener>());
  const counter = useRef(0);

  const pushNotice = useCallback((text: string) => {
    counter.current += 1;
    const notice = { id: counter.current, text };
    setNotices((current) => [...current.slice(-(KEPT_NOTICES - 1)), notice]);
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    let source: EventSource | null = null;
    // The stream stays open for the life of the page, so it starts once the first views have loaded: a page that
    // is still opening a long-lived request never settles for tools that wait for the network to go quiet.
    const timer = window.setTimeout(() => {
      source = new EventSource(/^\d+$/.test(LOAD_CURSOR) ? `/api/live?after=${LOAD_CURSOR}` : '/api/live');
      source.addEventListener('change', (event) => {
        const change = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
        listeners.current.forEach((listener) => listener(change));
      });
      source.addEventListener('notice', (event) => pushNotice((JSON.parse((event as MessageEvent<string>).data) as NoticeEvent).text));
      // Views load before the stream is subscribed, and a reconnect may miss events: reload whenever it opens.
      source.addEventListener('open', () => listeners.current.forEach((listener) => listener(null)));
    }, STREAM_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      source?.close();
    };
  }, [me, pushNotice]);

  const value = useMemo<Live>(
    () => ({
      notices,
      pushNotice,
      clearNotices: () => setNotices([]),
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      }
    }),
    [notices, pushNotice]
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error('LiveProvider is missing');
  return live;
}
