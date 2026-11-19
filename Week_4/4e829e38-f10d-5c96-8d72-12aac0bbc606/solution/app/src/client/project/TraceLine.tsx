import { useRef, useState } from "preact/hooks";
import { useMount } from "../hooks";

/** The pink-to-coral line through the tasks the last rule run changed, with black end dots. */
export function TraceLine({ ids, container, mode }: { ids: string[]; container: { current: HTMLElement | null }; mode: "list" | "board" | "timeline" }) {
  const [shape, setShape] = useState<{ width: number; height: number; points: Array<[number, number]> } | null>(null);
  const last = useRef("");
  useMount(() => {
    const root = container.current;
    if (!root || !ids.length) return void (shape && setShape(null));
    const box = root.getBoundingClientRect();
    const points: Array<[number, number]> = [];
    for (const id of ids) {
      const el = root.querySelector<HTMLElement>(`[data-task="${id}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      points.push(mode === "list" ? [16, rect.top - box.top + rect.height / 2] : [rect.left - box.left + rect.width / 2, rect.top - box.top + rect.height / 2]);
    }
    const signature = JSON.stringify([points, box.width, box.height]);
    if (signature === last.current) return;
    last.current = signature;
    setShape(points.length ? { width: box.width, height: box.height, points } : null);
  });
  if (!shape) return null;
  const pts = shape.points.length === 1 ? [[shape.points[0][0] - 28, shape.points[0][1]], [shape.points[0][0] + 28, shape.points[0][1]]] as Array<[number, number]> : shape.points;
  const d = pts.map(([x, y], i) => {
    if (i === 0) return `M ${x} ${y}`;
    const [px, py] = pts[i - 1];
    const mid = mode === "list" ? [x + 14, (py + y) / 2] : [(px + x) / 2, (py + y) / 2 - 18];
    return `Q ${mid[0]} ${mid[1]} ${x} ${y}`;
  }).join(" ");
  const first = pts[0];
  const end = pts[pts.length - 1];
  return (
    <svg class="trace" role="img" aria-label="Rule trace" width={shape.width} height={shape.height} viewBox={`0 0 ${shape.width} ${shape.height}`}>
      <defs>
        <linearGradient id="trace-gradient" gradientUnits="userSpaceOnUse" x1={first[0]} y1={first[1]} x2={end[0] === first[0] ? first[0] + 1 : end[0]} y2={end[1] === first[1] ? first[1] + 1 : end[1]}>
          <stop offset="0" stop-color="#FFC7F2" />
          <stop offset="1" stop-color="#F95A4E" />
        </linearGradient>
      </defs>
      <path key={ids.join(",")} class="trace-path" d={d} pathLength={1} fill="none" stroke="url(#trace-gradient)" stroke-width="2.5" stroke-linecap="round" />
      <circle cx={first[0]} cy={first[1]} r="4" fill="#0D0D0D" />
      <circle cx={end[0]} cy={end[1]} r="4" fill="#0D0D0D" />
    </svg>
  );
}
