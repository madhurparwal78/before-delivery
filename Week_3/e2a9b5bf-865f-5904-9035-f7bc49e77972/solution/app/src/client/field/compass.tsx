import { projectSky } from "../../shared/projection";
import type { View } from "./draw";

const CENTER = 32;
const ARM = 20;
const LABEL = 28;

export interface CompassParts {
  north: SVGLineElement | null;
  east: SVGLineElement | null;
  northLabel: SVGTextElement | null;
  eastLabel: SVGTextElement | null;
}

/** Points the N and E marks the way the current view points them. */
export function paintCompass(parts: CompassParts, view: View): void {
  const place = (line: SVGLineElement | null, label: SVGTextElement | null, east: number, north: number) => {
    const [x, y] = projectSky(east, north, view.rot, view.sx);
    line?.setAttribute("x2", String(CENTER + x * ARM));
    line?.setAttribute("y2", String(CENTER - y * ARM));
    label?.setAttribute("x", String(CENTER + x * LABEL));
    label?.setAttribute("y", String(CENTER - y * LABEL + 4));
  };
  place(parts.north, parts.northLabel, 0, 1);
  place(parts.east, parts.eastLabel, 1, 0);
}

export function Compass(props: { sentence: string; setParts(parts: CompassParts): void; view: View }) {
  const { view } = props;
  const [nx, ny] = projectSky(0, 1, view.rot, view.sx);
  const [ex, ey] = projectSky(1, 0, view.rot, view.sx);
  const grab = (el: SVGSVGElement | null) => {
    if (!el) return;
    props.setParts({
      north: el.querySelector<SVGLineElement>("[data-n]"),
      east: el.querySelector<SVGLineElement>("[data-e]"),
      northLabel: el.querySelector<SVGTextElement>("[data-nl]"),
      eastLabel: el.querySelector<SVGTextElement>("[data-el]"),
    });
  };
  return (
    <svg class="compass" ref={grab} role="img" aria-label={`Compass: ${props.sentence}`} viewBox="0 0 64 64" width="64" height="64">
      <circle cx={CENTER} cy={CENTER} r="2" fill="currentColor" />
      <line data-n x1={CENTER} y1={CENTER} x2={CENTER + nx * ARM} y2={CENTER - ny * ARM} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line data-e x1={CENTER} y1={CENTER} x2={CENTER + ex * ARM} y2={CENTER - ey * ARM} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <text data-nl x={CENTER + nx * LABEL} y={CENTER - ny * LABEL + 4} text-anchor="middle" font-size="12" fill="currentColor">
        N
      </text>
      <text data-el x={CENTER + ex * LABEL} y={CENTER - ey * LABEL + 4} text-anchor="middle" font-size="12" fill="currentColor">
        E
      </text>
    </svg>
  );
}
