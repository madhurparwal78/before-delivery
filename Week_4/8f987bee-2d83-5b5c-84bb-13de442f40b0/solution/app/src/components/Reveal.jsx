import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { prefersReducedMotion } from "../lib/motion.js";

const RISE_MS = 420;
const DISTANCE = 18;
const ease = (t) => 1 - (1 - t) ** 3;

// Sections marked data-reveal rise into place the first time they scroll into view. Until then they rest in
// place, so the content is there for anything that reads the page without scrolling it.
export function useReveal() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const pending = [...document.querySelectorAll("[data-reveal]")].filter(
      (el) => el.getBoundingClientRect().top >= window.innerHeight,
    );
    const started = new Map();
    let id = 0;
    const tick = (now) => {
      for (const el of pending) {
        if (!started.has(el) && el.getBoundingClientRect().top < window.innerHeight) started.set(el, now);
        if (!started.has(el)) continue;
        const t = Math.min(1, (now - started.get(el)) / RISE_MS);
        el.style.opacity = t >= 1 ? "" : String(ease(t));
        el.style.transform = t >= 1 ? "" : `translateY(${(DISTANCE * (1 - ease(t))).toFixed(2)}px)`;
      }
      if (started.size < pending.length || [...started.values()].some((s) => now - s < RISE_MS)) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      for (const el of pending) {
        el.style.opacity = "";
        el.style.transform = "";
      }
    };
  }, [pathname]);
}
