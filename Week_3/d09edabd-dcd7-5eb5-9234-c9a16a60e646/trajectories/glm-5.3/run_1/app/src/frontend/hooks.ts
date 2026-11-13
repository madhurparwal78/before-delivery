import { useEffect, useRef, useState, useCallback } from 'react';
import type { Placement } from '../shared/types.js';

/** Polite live region message helper. */
export function useLiveAnnounce(): [string, (msg: string) => void] {
  const [msg, setMsg] = useState('');
  return [msg, useCallback((m: string) => setMsg(m), [])];
}

/** The server clock: count down from served figures, resyncing on events and every 15s. */
export function useServerClock(
  served: { remainingSeconds: number; serverTime: string } | null,
  resyncKey: number
): number {
  const [remaining, setRemaining] = useState(served?.remainingSeconds ?? 0);
  const anchor = useRef<{ at: number; remaining: number }>({ at: 0, remaining: 0 });

  useEffect(() => {
    if (!served) return;
    const skew = Date.now() - new Date(served.serverTime).getTime();
    anchor.current = { at: Date.now() - skew, remaining: served.remainingSeconds };
    setRemaining(served.remainingSeconds);
  }, [served?.serverTime, served?.remainingSeconds, resyncKey]);

  useEffect(() => {
    if (!served) return;
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - anchor.current.at) / 1000);
      setRemaining(Math.max(0, anchor.current.remaining - elapsed));
    }, 250);
    return () => clearInterval(tick);
  }, [served, resyncKey]);

  return remaining;
}

/** The offline save queue, kept per room in localStorage (DP-48). */
export interface QueuedChange {
  opId: string;
  kind: 'patch' | 'delete' | 'scene-move' | 'drop';
  placementId: string | null;
  version?: number;
  body?: Record<string, unknown>;
  direction?: 'up' | 'down';
  label?: string;
}

const queueKey = (roomId: string) => `kb-queue-${roomId}`;

export function loadQueue(roomId: string): QueuedChange[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey(roomId)) ?? '[]') as QueuedChange[];
  } catch {
    return [];
  }
}

export function saveQueue(roomId: string, q: QueuedChange[]): void {
  localStorage.setItem(queueKey(roomId), JSON.stringify(q));
}

/** Reduced-motion preference. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Viewport width with the one breakpoint at 768px. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const on = () => setPhone(window.innerWidth < 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}

/** Apply queued changes on top of stored placements when a room opens. */
export function withQueueApplied(placements: Placement[], queue: QueuedChange[]): Placement[] {
  let out = placements.map((p) => ({ ...p }));
  for (const ch of queue) {
    if (ch.kind === 'delete') {
      out = out.filter((p) => p.id !== ch.placementId);
    } else if (ch.kind === 'patch' && ch.placementId) {
      const idx = out.findIndex((p) => p.id === ch.placementId);
      if (idx >= 0) out[idx] = { ...out[idx], ...(ch.body ?? {}) } as Placement;
    }
  }
  return out;
}

/** Fresh change ids. */
export function newOpId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** SSE subscription helper. */
export function useEventStream(path: string | null, onEvent: (event: string, data: unknown) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!path) return;
    const es = new EventSource(path);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { event: string; data: unknown };
        handler.current(parsed.event, parsed.data);
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [path]);
}
