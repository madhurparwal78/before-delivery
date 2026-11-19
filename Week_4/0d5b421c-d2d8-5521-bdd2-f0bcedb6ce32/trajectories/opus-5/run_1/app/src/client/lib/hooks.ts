import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StatusResponse } from '../../shared/types';
import { apiGet, serverNowMs } from './api';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export interface OutageState {
  holds: 'ok' | 'paused';
  deposits: 'ok' | 'paused';
  reportOutage: (code: string) => void;
}

export const OutageContext = createContext<OutageState>({
  holds: 'ok',
  deposits: 'ok',
  reportOutage: () => undefined,
});

export function useOutage(): OutageState {
  return useContext(OutageContext);
}

const STATUS_POLL_MS = 30000;

export function useStatusPolling(): OutageState {
  const [state, setState] = useState<{
    holds: 'ok' | 'paused';
    deposits: 'ok' | 'paused';
  }>({
    holds: 'ok',
    deposits: 'ok',
  });

  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      try {
        const status = await apiGet<StatusResponse>('/api/status');
        if (active) setState({ holds: status.holds, deposits: status.deposits });
      } catch {
        // A failed status check leaves the last known state in place.
      }
    };
    void check();
    const timer = setInterval(() => void check(), STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const reportOutage = useCallback((code: string) => {
    if (code === 'holds_paused') setState((current) => ({ ...current, holds: 'paused' }));
    if (code === 'deposits_paused') setState((current) => ({ ...current, deposits: 'paused' }));
  }, []);

  return useMemo(
    () => ({ holds: state.holds, deposits: state.deposits, reportOutage }),
    [state.holds, state.deposits, reportOutage],
  );
}

export interface Countdown {
  msLeft: number;
  secondsLeft: number;
  fraction: number;
}

/** Counts down to the server's expiry instant, corrected by the server clock offset. */
export function useCountdown(
  expiresAt: string | null,
  totalSeconds: number,
  reducedMotion: boolean,
): Countdown {
  const [now, setNow] = useState(() => serverNowMs());

  useEffect(() => {
    if (!expiresAt) return undefined;
    setNow(serverNowMs());
    const timer = setInterval(() => setNow(serverNowMs()), reducedMotion ? 1000 : 250);
    return () => clearInterval(timer);
  }, [expiresAt, reducedMotion]);

  if (!expiresAt) return { msLeft: 0, secondsLeft: 0, fraction: 0 };
  const endsAt = Date.parse(expiresAt);
  const msLeft = Math.max(0, endsAt - now);
  const totalMs = totalSeconds * 1000;
  if (reducedMotion) {
    const steps = Math.ceil(msLeft / 15000);
    const stepped = Math.min(msLeft, steps * 15000);
    return {
      msLeft,
      secondsLeft: Math.ceil(stepped / 1000),
      fraction: totalMs === 0 ? 0 : Math.min(1, stepped / totalMs),
    };
  }
  return {
    msLeft,
    secondsLeft: Math.ceil(msLeft / 1000),
    fraction: totalMs === 0 ? 0 : Math.min(1, msLeft / totalMs),
  };
}

export type LiveEventHandler<T> = (event: T) => void;

/** Keeps an event stream open, reconnecting by itself and replaying what it missed. */
export function useEventStream<T>(
  url: string | null,
  onEvent: LiveEventHandler<T>,
  onReconnect?: () => void,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;

  useEffect(() => {
    if (!url) return undefined;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let stopped = false;
    let hadError = false;
    let lastId: string | null = null;

    const open = (): void => {
      const target =
        lastId === null
          ? url
          : `${url}${url.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastId)}`;
      source = new EventSource(target);
      source.onopen = () => {
        if (hadError) {
          hadError = false;
          reconnect.current?.();
        }
      };
      source.onmessage = (message) => {
        if (message.lastEventId) lastId = message.lastEventId;
        handler.current(JSON.parse(message.data) as T);
      };
      source.onerror = () => {
        hadError = true;
        if (stopped) return;
        // The browser retries by itself while the stream stays open; a closed stream is ours
        // to reopen, carrying the last id we saw so nothing is missed.
        if (source && source.readyState === EventSource.CLOSED) {
          source = null;
          retryTimer = window.setTimeout(open, 1000);
        }
      };
    };
    open();

    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [url]);
}
