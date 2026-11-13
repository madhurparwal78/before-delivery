import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, get } from '../api';
import type { Marker } from '../three/roomView';
import { isFinished } from '../../shared/playtest';
import type { PlayNode, PlaySession, PlayView } from '../../shared/types';

/** The page re-reads the session from the server at least this often. */
const RESYNC_MS = 15_000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  /** The session ended while the page was open; `session` carries the outcome when an event or a solve told us. */
  | { kind: 'ended'; session: PlaySession | null }
  /** `receivedAt` is the page clock (`performance.now()`) when `view` arrived: the remaining time is counted down from there. */
  | { kind: 'live'; view: PlayView; receivedAt: number };

export interface SolveResult {
  nodes: PlayNode[];
  session: PlaySession;
}

interface TesterEvent {
  displayName: string;
  xMm: number;
  zMm: number;
  headingDeg: number;
}


const isFinal = (phase: Phase): boolean => phase.kind === 'invalid' || phase.kind === 'expired' || phase.kind === 'ended';

/** Once the link is invalid or the session is over, a late answer does not bring the session back. */
const settle = (prev: Phase, next: Phase): Phase => (isFinal(prev) ? prev : next);

const arrived = (view: PlayView): Phase => ({ kind: 'live', view, receivedAt: performance.now() });

const payload = <T>(event: Event): T => JSON.parse((event as MessageEvent<string>).data) as T;

/**
 * The tester's session as the server has it: loaded once, then kept true by the events stream and a resync
 * at least every 15 seconds. Time is never worked out from the device clock.
 */
export function usePlaytest(token: string, announce: (message: string) => void) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const syncing = useRef(false);
  const again = useRef(false);
  const me = useRef<string | null>(null);
  me.current = phase.kind === 'live' ? phase.view.me.displayName : null;

  const pull = useCallback(async (): Promise<void> => {
    try {
      const next = arrived(await get<PlayView>(`/api/play/${token}`));
      setPhase((prev) => settle(prev, next));
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) return;
      if (failure.status === 404) setPhase((prev) => settle(prev, { kind: 'invalid' }));
      if (failure.status === 410) setPhase((prev) => (prev.kind === 'live' ? { kind: 'ended', session: null } : settle(prev, { kind: 'expired' })));
    }
  }, [token]);

  /** One read at a time; a request made meanwhile runs once more afterwards. */
  const sync = useCallback(async (): Promise<void> => {
    if (syncing.current) {
      again.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        again.current = false;
        await pull();
      } while (again.current);
    } finally {
      syncing.current = false;
    }
  }, [pull]);

  useEffect(() => {
    void sync();
  }, [sync]);

  const live = phase.kind === 'live';
  useEffect(() => {
    if (!live) return;
    const source = new EventSource(`/api/play/${token}/events`);
    const resync = (): void => void sync();
    source.addEventListener('open', resync);
    source.addEventListener('live', resync);
    source.addEventListener('solve', resync);
    source.addEventListener('session', (event) => {
      const { session } = payload<{ session: PlaySession }>(event);
      if (isFinished(session.state)) setPhase((prev) => settle(prev, { kind: 'ended', session }));
      else resync();
    });
    source.addEventListener('hint', (event) => {
      announce(`Hint: ${payload<{ text: string }>(event).text}`);
      resync();
    });
    source.addEventListener('tester', (event) => {
      const tester = payload<TesterEvent>(event);
      if (tester.displayName === me.current) return;
      const marker: Marker = { id: tester.displayName, label: tester.displayName, xMm: tester.xMm, zMm: tester.zMm, headingDeg: tester.headingDeg };
      setMarkers((prev) => [...prev.filter((m) => m.id !== marker.id), marker]);
    });
    const timer = window.setInterval(resync, RESYNC_MS);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [token, live, sync, announce]);

  const joined = useCallback((view: PlayView): void => {
    const next = arrived(view);
    setPhase((prev) => settle(prev, next));
  }, []);

  const solved = useCallback((result: SolveResult): void => {
    const receivedAt = performance.now();
    setPhase((prev) => {
      if (prev.kind !== 'live') return prev;
      if (isFinished(result.session.state)) return { kind: 'ended', session: result.session };
      return { kind: 'live', view: { ...prev.view, nodes: result.nodes, session: result.session }, receivedAt };
    });
  }, []);

  return { phase, markers, sync, joined, solved };
}
