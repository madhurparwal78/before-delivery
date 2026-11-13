import { useEffect, useMemo, useReducer, useRef } from 'react';

const TICK_MS = 250;

/** A server figure in seconds, counted down by the page time that passed since it arrived (never the device clock). */
export const secondsLeft = (seconds: number, receivedAt: number): number => Math.max(0, seconds - Math.floor(Math.max(0, performance.now() - receivedAt) / 1000));

/** Re-renders its component a few times a second so a countdown stays current. */
export function useTicker(): void {
  const [, render] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(render, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
}

/** The countdown of a figure that arrives with `key` (a new object each time the server sends it). */
export function useCountdown(seconds: number, key: unknown): number {
  const received = useRef(performance.now());
  useMemo(() => {
    received.current = performance.now();
  }, [key]);
  useTicker();
  return secondsLeft(seconds, received.current);
}
