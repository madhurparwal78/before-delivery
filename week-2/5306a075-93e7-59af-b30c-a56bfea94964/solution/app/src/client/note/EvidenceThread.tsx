// The evidence thread (brief: Motion and effects): a thin cobalt S-curve draws from the quote's last mark to
// the feature row (slow), stays attached while the row counts and slides (medium), then fades (quick).
import { useLayoutEffect, useRef } from "react";
import { MEDIUM, QUICK, SETTLE, SLOW } from "../motion.js";

export interface ThreadPlan {
  insightId: string;
  featureId: string;
  featureName: string;
  /** Called when the line reaches the row: the rail then shows the new numbers and rank. */
  reached: () => void;
  done: () => void;
}

interface Point { x: number; y: number }

/** An S-curve that leaves the quote upward, so it never reads as a strikethrough of the line it starts on. */
function curve(from: Point, to: Point): string {
  const bend = Math.max(40, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend / 2} ${from.y - 48}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

function quoteEnd(insightId: string): Point | null {
  const marks = document.querySelectorAll<HTMLElement>(`mark[data-insights~="${CSS.escape(insightId)}"]`);
  const last = marks[marks.length - 1];
  if (!last) return null;
  const rects = last.getClientRects();
  const rect = rects[rects.length - 1] ?? last.getBoundingClientRect();
  return { x: rect.right, y: rect.top + 3 };
}

function rowStart(featureId: string): Point | null {
  const row = document.querySelector<HTMLElement>(`[data-feature-row="${CSS.escape(featureId)}"] .feature-row`);
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  return { x: rect.left, y: rect.top + rect.height / 2 };
}

export function EvidenceThread({ plan }: { plan: ThreadPlan }) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);

  useLayoutEffect(() => {
    const line = path.current;
    const frame = svg.current;
    const from = quoteEnd(plan.insightId);
    const to = rowStart(plan.featureId);
    if (!line || !frame || !from || !to) {
      plan.reached();
      plan.done();
      return;
    }
    let cancelled = false;
    line.setAttribute("d", curve(from, to));
    const length = line.getTotalLength();
    line.style.strokeDasharray = `${length}`;
    const run = async (): Promise<void> => {
      await line.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: SLOW, easing: SETTLE, fill: "forwards" }).finished;
      if (cancelled) return;
      plan.reached();
      const follow = frame.animate([{ opacity: 1 }, { opacity: 1 }], { duration: MEDIUM });
      const track = (): void => {
        const end = rowStart(plan.featureId);
        const start = quoteEnd(plan.insightId);
        if (end && start) {
          line.setAttribute("d", curve(start, end));
          line.style.strokeDasharray = "none";
        }
        if (follow.playState === "running") requestAnimationFrame(track);
      };
      requestAnimationFrame(track);
      await follow.finished;
      if (cancelled) return;
      await frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: QUICK, easing: SETTLE, fill: "forwards" }).finished;
      if (!cancelled) plan.done();
    };
    run().catch(() => { if (!cancelled) plan.done(); });
    return () => { cancelled = true; };
  }, [plan]);

  return (
    <svg ref={svg} className="thread" role="img" aria-label={`Evidence thread to ${plan.featureName}`}>
      <path ref={path} className="thread-line" d="M 0 0" />
    </svg>
  );
}

/** The thread that follows the pointer while a pending quote is dragged toward the rail. */
export function DragThread({ from, to, retracting, onRetracted }: { from: Point; to: Point; retracting: boolean; onRetracted: () => void }) {
  const path = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const line = path.current;
    if (!retracting || !line) return;
    const length = line.getTotalLength();
    line.style.strokeDasharray = `${length}`;
    line.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: length }], { duration: QUICK, easing: SETTLE, fill: "forwards" }).finished.then(onRetracted, onRetracted);
  }, [retracting, onRetracted]);
  return (
    <svg className="thread" aria-hidden="true">
      <path ref={path} className="thread-line" d={curve(from, to)} />
    </svg>
  );
}
