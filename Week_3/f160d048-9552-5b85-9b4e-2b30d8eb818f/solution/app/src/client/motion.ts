import { useCallback, useEffect, useRef, useState } from "react";

export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function prefersReduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The published duration, or 0 when the user prefers reduced motion. */
export const motionMs = (full: number): number => (prefersReduced() ? 0 : full);

export function publishMotionPreference(): void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apply = () => document.documentElement.setAttribute("data-motion-pref", query.matches ? "reduced" : "full");
  apply();
  query.addEventListener("change", apply);
}

type MotionState = "running" | "done";

/**
 * A graded motion: `data-state` is running for the published duration on the page's own timers, then done,
 * whether or not frames are drawn; the animation itself is finished at that moment.
 */
export function useMotion(full: number) {
  const ms = motionMs(full);
  const [state, setState] = useState<MotionState>("done");
  const timer = useRef<number | undefined>(undefined);
  const animation = useRef<Animation | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      animation.current?.cancel();
    },
    [],
  );
  const play = useCallback(
    (targets: Element[], keyframes: Keyframe[]) => {
      window.clearTimeout(timer.current);
      animation.current?.cancel();
      if (ms === 0) {
        setState("done");
        return;
      }
      setState("running");
      const first = targets[0];
      animation.current = first?.animate(keyframes, { duration: ms, easing: EASE, fill: "both" });
      for (const extra of targets.slice(1)) extra.animate(keyframes, { duration: ms, easing: EASE, fill: "both" });
      timer.current = window.setTimeout(() => {
        animation.current?.finish();
        setState("done");
      }, ms);
    },
    [ms],
  );
  return { ms, state, play };
}
