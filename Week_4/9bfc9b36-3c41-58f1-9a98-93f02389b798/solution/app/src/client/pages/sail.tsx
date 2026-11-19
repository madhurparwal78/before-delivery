/**
 * The sail drawn as the real thing. On the nesting screen the crosscut panels stack along the leech in their own
 * frame, so the thread runs the way it runs on the roll. On the Draw step the same outlines are turned into the
 * sail's own frame, the way a sailmaker draws it: luff up the left, head at the top, seams square to the leech.
 */
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Outline, Panel } from "../../shared/types.js";

interface SailLayout {
  width: number;
  height: number;
  shapes: { panel: Panel; outline: Outline; offset: number }[];
}

/** Panel k sits a_k along the leech, a_k being the widths of the panels before it. */
function layoutSail(panels: Panel[]): SailLayout {
  let offset = 0;
  let width = 0;
  const shapes = panels.map((panel) => {
    const placed: Outline = panel.outline.map(([x, y]) => [x, y + offset]);
    const shape = { panel, outline: placed, offset };
    offset += panel.width_mm;
    width = Math.max(width, panel.length_mm);
    return shape;
  });
  return { width, height: offset, shapes };
}

/** The rig a drawing was drawn from: the luff and foot of its right triangle. */
interface Rig {
  luff: number;
  foot: number;
}

/**
 * The rotation from leech coordinates (x = v toward the tack, y = s along the leech from the clew) into the
 * sail's frame on screen (tack bottom left, clew bottom right, head top left). Its determinant is 1, so outlines
 * are turned and never mirrored.
 */
function sailFrame({ luff, foot }: Rig) {
  const leech = Math.hypot(luff, foot);
  const [a, b, c, d, e, f] = [-luff / leech, foot / leech, -foot / leech, -luff / leech, foot, luff];
  return {
    matrix: `matrix(${a} ${b} ${c} ${d} ${e} ${f})`,
    at: ([x, y]: [number, number]): [number, number] => [a * x + c * y + e, b * x + d * y + f],
    /** A unit step out of the sail, square to the leech, on screen. */
    outward: [luff / leech, -foot / leech] as [number, number],
  };
}

/** The centre of an outline's area (the mean of its corners for a degenerate one). */
function centroid(outline: Outline): [number, number] {
  let twice = 0;
  let cx = 0;
  let cy = 0;
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length]!;
    const cross = x0 * y1 - x1 * y0;
    twice += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  });
  if (twice === 0) return [outline.reduce((sum, [x]) => sum + x, 0) / outline.length, outline.reduce((sum, [, y]) => sum + y, 0) / outline.length];
  return [cx / (3 * twice), cy / (3 * twice)];
}

const points = (outline: Outline): string => outline.map(([x, y]) => `${x},${y}`).join(" ");

export const outlinePoints = points;

interface CanvasProps {
  panels: Panel[];
  label: string;
  selected: number | null;
  /** "draw": panels are buttons. "nest": panels are images that can be dragged. */
  mode: "draw" | "nest";
  onSelect: (panel: number) => void;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>, panel: number) => void;
  onPointerMove?: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<SVGGElement>) => void;
  dimmed?: Set<number>;
  hidden?: Set<number>;
  /** When given, the panels are drawn in the sail's own frame (the Draw step). */
  rig?: Rig;
}

export function SailCanvas({ panels, label, selected, mode, onSelect, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, dimmed, hidden, rig }: CanvasProps) {
  const layout = layoutSail(panels);
  const pad = Math.max(layout.width, layout.height) * 0.03;
  const strokeWidth = Math.max(layout.width, layout.height) / 420;
  const frame = rig ? sailFrame(rig) : null;
  const svg = useRef<SVGSVGElement>(null);
  const [shownHeight, setShownHeight] = useState(400);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element || !rig) return;
    const observer = new ResizeObserver(() => setShownHeight(element.clientHeight || 400));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rig]);
  /** Labels in the sail frame share one size, never under 13 px on screen; a panel too small to hold its number gets a leader. */
  const labelSize = rig ? Math.max(Math.max(rig.luff, rig.foot) / 40, (13 * rig.luff * 1.12) / shownHeight) : 0;
  const labels = frame
    ? layout.shapes.map(({ panel, outline }) => {
        const inside = frame.at(centroid(outline));
        const roomy = Math.min(panel.width_mm, panel.length_mm) * 0.5 >= labelSize * 1.2 && panel.area_mm2 >= (labelSize * 2.4) ** 2;
        const reach = labelSize * 2.2;
        const out: [number, number] = roomy ? inside : [inside[0] + frame.outward[0] * reach, inside[1] + frame.outward[1] * reach];
        return { number: panel.number, inside, out, roomy };
      })
    : [];
  const viewBox = rig
    ? `${-pad} ${-pad - labelSize} ${rig.foot + 2 * pad + labelSize * 3} ${rig.luff + 2 * pad + labelSize}`
    : `${-pad} ${-pad} ${layout.width + 2 * pad} ${layout.height + 2 * pad}`;
  return (
    <svg
      ref={svg}
      className="sail-svg"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-label={label}
      role="group"
    >
      {layout.shapes.map(({ panel, outline, offset }) => {
        const isSelected = selected === panel.number;
        const common = {
          "data-panel": panel.number,
          className: `sail-panel${isSelected ? " selected" : ""}${dimmed?.has(panel.number) ? " dimmed" : ""}${hidden?.has(panel.number) ? " lifted" : ""}`,
          onPointerDown: onPointerDown ? (event: ReactPointerEvent<SVGGElement>) => onPointerDown(event, panel.number) : undefined,
          onPointerMove,
          onPointerUp,
          onPointerCancel,
        };
        const body = (
          <>
            <rect x={0} y={offset} width={panel.length_mm} height={panel.width_mm} fill="transparent" transform={frame?.matrix} />
            <polygon points={points(outline)} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" transform={frame?.matrix} />
            {frame ? null : (
              <text x={Math.min(panel.length_mm * 0.08, panel.length_mm)} y={offset + panel.width_mm / 2} fontSize={panel.width_mm * 0.34} dominantBaseline="middle">
                {panel.number}
              </text>
            )}
          </>
        );
        return mode === "draw" ? (
          <g
            key={panel.number}
            {...common}
            role="button"
            tabIndex={0}
            aria-label={`Panel ${panel.number}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(panel.number)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(panel.number);
              }
            }}
          >
            {body}
          </g>
        ) : (
          <g key={panel.number} {...common} role="img" aria-label={`Drawing panel ${panel.number}`} onClick={() => onSelect(panel.number)}>
            {body}
          </g>
        );
      })}
      {frame ? (
        <g className="sail-labels" aria-hidden="true">
          {labels.map(({ number, inside, out, roomy }) => (
            <g key={number} className={selected === number ? "selected" : undefined}>
              {roomy ? null : <line x1={inside[0]} y1={inside[1]} x2={out[0] - frame.outward[0] * labelSize * 0.5} y2={out[1] - frame.outward[1] * labelSize * 0.5} vectorEffect="non-scaling-stroke" />}
              <text x={out[0]} y={out[1]} fontSize={labelSize} textAnchor={roomy ? "middle" : "start"} dominantBaseline="central">
                {number}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}
