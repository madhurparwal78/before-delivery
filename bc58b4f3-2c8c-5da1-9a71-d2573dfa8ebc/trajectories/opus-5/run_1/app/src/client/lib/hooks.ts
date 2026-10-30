import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeatStatus } from './api';

const REFRESH_MS = 3000;
export const FILL_MS = 500;
const COUNT_MS = 350;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export interface PollState<Data> {
  data: Data | null;
  failing: boolean;
  refresh: () => void;
}

/** Keeps a screen within the refresh delay by asking the API again. */
export function usePolling<Data>(load: () => Promise<Data>, deps: readonly unknown[]): PollState<Data> {
  const [data, setData] = useState<Data | null>(null);
  const [failing, setFailing] = useState(false);
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback(async () => {
    try {
      const next = await loader.current();
      setData(next);
      setFailing(false);
    } catch {
      setFailing(true);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void run();
    const timer = window.setInterval(() => void run(), REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, failing, refresh: () => void run() };
}

export interface SeatSnapshot {
  seat: number;
  status: SeatStatus;
  initials: string | null;
}

export interface SeatGroup {
  key: string;
  seats: SeatSnapshot[];
}

export type LaneFill = 'none' | 'full' | 'growing' | 'shrinking';

export interface LaneView extends SeatSnapshot {
  fill: LaneFill;
}

export interface SeatMotionEvents {
  onCovered?: (key: string, seat: number, initials: string | null) => void;
  onReopened?: (key: string, seat: number) => void;
}

export interface SeatMotion {
  lanes: Map<string, LaneView[]>;
  pending: Set<string>;
}

function settled(seat: SeatSnapshot): LaneView {
  return { ...seat, fill: seat.status === 'open' ? 'none' : 'full' };
}

/**
 * The Hatch Seam: a seat only fills once the server says it is held. The fill
 * sweeps first, then the label switches, and the caller is told so it can count
 * its numeral down. A reopened seat runs the same steps backwards.
 */
export function useSeatMotion(groups: SeatGroup[], events: SeatMotionEvents): SeatMotion {
  const reduced = useReducedMotion();
  const lanes = useRef(new Map<string, LaneView[]>());
  const inFlight = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const handlers = useRef(events);
  handlers.current = events;
  const [motion, setMotion] = useState<SeatMotion>({
    lanes: new Map(),
    pending: new Set(),
  });

  const publish = useCallback(() => {
    setMotion({ lanes: new Map(lanes.current), pending: new Set(inFlight.current) });
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const later = useCallback((run: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, delay);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const keys = new Set(groups.map((group) => group.key));
    for (const key of [...lanes.current.keys()]) {
      if (!keys.has(key)) lanes.current.delete(key);
    }

    for (const group of groups) {
      const shown = lanes.current.get(group.key);
      if (shown === undefined) {
        lanes.current.set(group.key, group.seats.map(settled));
        continue;
      }
      const next = group.seats.map((seat): LaneView => {
        const was = shown.find((lane) => lane.seat === seat.seat);
        const laneKey = `${group.key}:${seat.seat}`;
        if (was === undefined) return settled(seat);
        if (inFlight.current.has(laneKey)) return was;

        if (was.status === 'open' && seat.status !== 'open') {
          const commit = (): void => {
            const current = lanes.current.get(group.key);
            if (current !== undefined) {
              lanes.current.set(
                group.key,
                current.map((lane) => (lane.seat === seat.seat ? settled(seat) : lane)),
              );
            }
            inFlight.current.delete(laneKey);
            publish();
            handlers.current.onCovered?.(group.key, seat.seat, seat.initials);
          };
          if (reduced) {
            handlers.current.onCovered?.(group.key, seat.seat, seat.initials);
            return settled(seat);
          }
          inFlight.current.add(laneKey);
          later(commit, FILL_MS);
          return { seat: seat.seat, status: 'open', initials: null, fill: 'growing' };
        }

        if (was.status !== 'open' && seat.status === 'open') {
          handlers.current.onReopened?.(group.key, seat.seat);
          if (reduced) return settled(seat);
          inFlight.current.add(laneKey);
          later(() => {
            const current = lanes.current.get(group.key);
            if (current !== undefined) {
              lanes.current.set(
                group.key,
                current.map((lane) => (lane.seat === seat.seat ? settled(seat) : lane)),
              );
            }
            inFlight.current.delete(laneKey);
            publish();
          }, FILL_MS);
          return { seat: seat.seat, status: 'open', initials: null, fill: 'shrinking' };
        }

        return settled(seat);
      });
      lanes.current.set(group.key, next);
    }
    publish();
  }, [groups, reduced, later, publish]);

  return motion;
}

/** Counts a numeral from its last value to the server's value. */
export function useCountingNumerals(
  targets: Record<string, number>,
  frozen: Set<string>,
): Record<string, number> {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Record<string, number>>({});
  const current = useRef<Record<string, number>>({});
  const frames = useRef(new Set<number>());

  useEffect(
    () => () => {
      for (const frame of frames.current) window.cancelAnimationFrame(frame);
      frames.current.clear();
    },
    [],
  );

  useEffect(() => {
    for (const [key, target] of Object.entries(targets)) {
      if (frozen.has(key)) continue;
      const from = current.current[key];
      if (from === target) continue;
      if (from === undefined || reduced) {
        current.current = { ...current.current, [key]: target };
        setShown({ ...current.current });
        continue;
      }
      const started = performance.now();
      const step = (): void => {
        const progress = Math.min(1, (performance.now() - started) / COUNT_MS);
        const value = progress === 1 ? target : Math.round(from + (target - from) * progress);
        current.current = { ...current.current, [key]: value };
        setShown({ ...current.current });
        if (progress < 1) {
          const frame = window.requestAnimationFrame(() => {
            frames.current.delete(frame);
            step();
          });
          frames.current.add(frame);
        }
      };
      step();
    }
  }, [targets, frozen, reduced]);

  return shown;
}

const openPanels: symbol[] = [];

/**
 * Escape closes the panel opened last, so a dialog over the drawer closes only
 * the dialog however the keystroke reaches the page.
 */
export function useEscapeKey(onEscape: () => void): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    const panel = Symbol('panel');
    openPanels.push(panel);
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (openPanels[openPanels.length - 1] !== panel) return;
      handler.current();
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      openPanels.splice(openPanels.indexOf(panel), 1);
    };
  }, []);
}

/** Holds Tab focus inside an open dialog or drawer. */
export function useFocusTrap(container: HTMLElement | null): void {
  useEffect(() => {
    if (container === null) return;
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null || element === document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', listener);
    return () => container.removeEventListener('keydown', listener);
  }, [container]);
}

/** True while the viewport shows one board day at a time. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const listener = (): void => setNarrow(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return narrow;
}
