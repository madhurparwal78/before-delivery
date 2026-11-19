import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion.js";

const GAP = 22;
const CYCLE_MS = 6000;

// The hero backdrop: a faint dot grid with a slow shimmer; one still frame under reduced motion.
export default function DotGrid() {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el.getContext("2d");
    const reduced = prefersReducedMotion();
    let id = 0;
    let width = 0;
    let height = 0;
    const size = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (now) => {
      ctx.clearRect(0, 0, width, height);
      const phase = (now % CYCLE_MS) / CYCLE_MS * Math.PI * 2;
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) {
          const wave = Math.sin(phase + x * 0.012 + y * 0.018) * Math.cos(phase * 0.5 - x * 0.006);
          const lit = Math.max(0, wave);
          ctx.fillStyle = lit > 0.55 ? `rgba(110, 75, 234, ${0.12 + lit * 0.32})` : `rgba(10, 10, 10, ${0.1 + lit * 0.08})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.1 + lit * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    const tick = (now) => {
      draw(now);
      id = requestAnimationFrame(tick);
    };
    size();
    if (reduced) draw(0);
    else id = requestAnimationFrame(tick);
    const onResize = () => {
      size();
      if (reduced) draw(0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={canvas} className="hero-canvas" aria-hidden="true" />;
}
