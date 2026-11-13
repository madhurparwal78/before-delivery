import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MOTION_MS, type MotionName } from "../../shared/motion";

const query = window.matchMedia("(prefers-reduced-motion: reduce)");

function applyPref(): void {
  document.documentElement.setAttribute("data-motion-pref", query.matches ? "reduced" : "full");
}
applyPref();
query.addEventListener("change", applyPref);

export function isReduced(): boolean {
  return query.matches;
}

function motionMs(name: MotionName): number {
  return query.matches ? 0 : MOTION_MS[name];
}

type MotionState = "running" | "done";

/** A motion that reads `running` for its published duration on the page clock, then `done`. */
export function useMotion(name: MotionName): { state: MotionState; ms: number; play: () => void } {
  const [state, setState] = useState<MotionState>("done");
  const timer = useRef<number | undefined>(undefined);
  const ms = motionMs(name);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const play = useCallback(() => {
    window.clearTimeout(timer.current);
    if (query.matches) {
      setState("done");
      return;
    }
    setState("running");
    timer.current = window.setTimeout(() => setState("done"), MOTION_MS[name]);
  }, [name]);
  return { state, ms, play };
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** Tween a value on the page clock (requestAnimationFrame follows it). */
export function tween(ms: number, step: (progress: number) => void, done?: () => void): () => void {
  if (ms <= 0) {
    step(1);
    done?.();
    return () => undefined;
  }
  let frame = 0;
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    step(ease(t));
    if (t < 1) frame = requestAnimationFrame(tick);
    else done?.();
  };
  step(0);
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

export function usePhone(): boolean {
  const phone = window.matchMedia("(max-width: 640px)");
  return useSyncExternalStore(
    (listener) => {
      phone.addEventListener("change", listener);
      return () => phone.removeEventListener("change", listener);
    },
    () => phone.matches,
  );
}
