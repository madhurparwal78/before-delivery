import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Countdown, mmss, remainingNow } from "../clock";

const segmentCount = 10;
const segmentDegrees = 360 / segmentCount;
const segmentGap = 3;
const lastMinuteMs = 60_000;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The ring is drawn from (1 - r) * 360 degrees clockwise from 12 o'clock to 360 degrees. */
function arcMask(r: number): string {
  const start = ((1 - r) * 360).toFixed(2);
  return `conic-gradient(from 0deg, transparent 0deg ${start}deg, #000 ${start}deg 360deg)`;
}

/** Under reduced motion: ten still segments, dropping one per minute from 12 o'clock clockwise. */
function segmentMask(shown: number): string {
  const stops = ["transparent 0deg"];
  for (let k = segmentCount - shown; k < segmentCount; k++) {
    const from = (k * segmentDegrees + segmentGap / 2).toFixed(2);
    const to = ((k + 1) * segmentDegrees - segmentGap / 2).toFixed(2);
    stops.push(`transparent ${from}deg`, `#000 ${from}deg`, `#000 ${to}deg`, `transparent ${to}deg`);
  }
  stops.push("transparent 360deg");
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

interface HaloProps {
  countdown: Countdown;
  shape: "disc" | "cell";
}

/** The countdown halo: a lime ring along the inside of the outer edge that empties clockwise in step with the server's remaining time. */
export function Halo({ countdown, shape }: HaloProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    let frame = 0;
    let drawnSegments = -1;
    const draw = () => {
      const element = ref.current;
      if (!element) return;
      const remaining = remainingNow(countdown);
      const r = Math.min(1, Math.max(0, remaining / countdown.holdMs));
      element.setAttribute("data-halo-remaining", r.toFixed(3));
      element.setAttribute("data-halo-tone", remaining <= lastMinuteMs ? "ink" : "lime");
      if (reduced) {
        const shown = Math.min(segmentCount, Math.ceil(remaining / lastMinuteMs));
        if (shown !== drawnSegments) {
          drawnSegments = shown;
          element.setAttribute("data-halo-segments", String(shown));
          element.style.setProperty("--halo-mask", segmentMask(shown));
        }
      } else {
        element.removeAttribute("data-halo-segments");
        element.style.setProperty("--halo-mask", arcMask(r));
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [countdown, reduced]);

  return (
    <span ref={ref} className={`halo halo--${shape}`} aria-hidden="true">
      <span className="halo__band" />
    </span>
  );
}

/** The badge digits, updated every second from the server-timed countdown. */
export function useCountdownText(countdown: Countdown | null, onZero: () => void): string {
  const [text, setText] = useState(() => (countdown ? mmss(remainingNow(countdown)) : "00:00"));
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => {
    if (!countdown) return;
    let frame = 0;
    let reachedZero = false;
    const tick = () => {
      const remaining = remainingNow(countdown);
      setText((current) => {
        const next = mmss(remaining);
        return next === current ? current : next;
      });
      if (remaining <= 0 && !reachedZero) {
        reachedZero = true;
        zero.current();
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [countdown]);
  return text;
}
