// The chapter frame grid on working screens: hairlines on both axes, extended edge to edge from the edges of the
// grid-framed cells on screen, so the grid re-cuts itself around whatever is shown (brief: Composition).
import { useEffect, useRef, useState, type ReactNode } from "react";

interface Lines {
  xs: number[];
  ys: number[];
  width: number;
  height: number;
}

const unique = (values: number[]): number[] => [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);

export function FrameGrid({ watch }: { watch: HTMLElement | null }): ReactNode {
  const [lines, setLines] = useState<Lines>({ xs: [], ys: [], width: 0, height: 0 });
  const frame = useRef(0);

  useEffect(() => {
    if (!watch) return;
    const measure = (): void => {
      frame.current = 0;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const cell of watch.querySelectorAll<HTMLElement>("[data-frame]")) {
        const box = cell.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        xs.push(box.left + window.scrollX, box.right + window.scrollX);
        ys.push(box.top + window.scrollY, box.bottom + window.scrollY);
      }
      setLines({ xs: unique(xs), ys: unique(ys), width: document.documentElement.clientWidth, height: Math.max(watch.scrollHeight, window.innerHeight) });
    };
    const schedule = (): void => {
      if (!frame.current) frame.current = window.requestAnimationFrame(measure);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(watch);
    const mutations = new MutationObserver(schedule);
    mutations.observe(watch, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame.current);
    };
  }, [watch]);

  return (
    <div className="frame-grid" aria-hidden="true" style={{ height: lines.height }}>
      {lines.xs.map((x) => (
        <i key={`x${x}`} className="line hair-x" style={{ left: x }} />
      ))}
      {lines.ys.map((y) => (
        <i key={`y${y}`} className="line hair-y" style={{ top: y }} />
      ))}
    </div>
  );
}
