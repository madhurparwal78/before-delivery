import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Live events are re-broadcast on window so panels can refresh what they show.
const LIVE = "rimewire:live";

type LiveEvent = { name: string; data: unknown };

export function broadcastLive(event: LiveEvent): void {
  window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE, { detail: event }));
}

export function useLiveEvent(handler: (event: LiveEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (e: Event) => ref.current((e as CustomEvent<LiveEvent>).detail);
    window.addEventListener(LIVE, listener);
    return () => window.removeEventListener(LIVE, listener);
  }, []);
}

// Re-renders every `ms` while mounted (menus re-check Edit, the scrubber track grows).
export function useTick(ms: number, active = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, active]);
  return tick;
}

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      motionQuery.addEventListener("change", onChange);
      return () => motionQuery.removeEventListener("change", onChange);
    },
    () => motionQuery.matches,
  );
}

const narrowQuery = window.matchMedia("(max-width: 599px)");

export function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      narrowQuery.addEventListener("change", onChange);
      return () => narrowQuery.removeEventListener("change", onChange);
    },
    () => narrowQuery.matches,
  );
}
