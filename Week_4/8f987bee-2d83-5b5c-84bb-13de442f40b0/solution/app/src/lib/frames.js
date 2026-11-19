import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion.js";

// One requestAnimationFrame loop for the component's life; `step(now, reduced)` returns false to stop.
export function useFrames(step) {
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    const reduced = prefersReducedMotion();
    let id = 0;
    const tick = (now) => {
      if (latest.current(now, reduced) !== false) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
}

export function inView(el) {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}
