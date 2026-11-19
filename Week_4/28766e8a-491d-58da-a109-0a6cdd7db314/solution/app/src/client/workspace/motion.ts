// Reversible rail motion driven frame by frame (brief: Inspector rail, Reduced motion). Progress
// moves at 1 / 200 per millisecond of page time, so a toggle mid-motion reverses from where it is.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { reducedMotion } from "./store";

const RAIL_MS = 200;

type MotionState = "opening" | "open" | "closing" | "closed";

interface Rail {
  motion: MotionState;
  progress: number;
}

/** Drives a rail toward open or closed; returns its motion state and progress. */
export function useRail(open: boolean): Rail {
  const [rail, setRail] = useState<Rail>({ motion: open ? "open" : "closed", progress: open ? 1 : 0 });
  const current = useRef(rail);
  current.current = rail;
  useLayoutEffect(() => {
    const goal = open ? 1 : 0;
    if (current.current.progress === goal) {
      setRail({ motion: open ? "open" : "closed", progress: goal });
      return undefined;
    }
    if (reducedMotion()) {
      setRail({ motion: open ? "open" : "closed", progress: goal });
      return undefined;
    }
    let last = performance.now();
    let progress = current.current.progress;
    setRail({ motion: open ? "opening" : "closing", progress });
    let raf = requestAnimationFrame(function frame() {
      const now = performance.now();
      progress = Math.min(1, Math.max(0, progress + ((open ? 1 : -1) * (now - last)) / RAIL_MS));
      last = now;
      if (progress === goal) {
        setRail({ motion: open ? "open" : "closed", progress: goal });
        return;
      }
      setRail({ motion: open ? "opening" : "closing", progress });
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);
  return rail;
}

/** Fast start, soft settle. */
export function settleEase(t: number): number {
  return 1 - (1 - t) ** 3;
}
