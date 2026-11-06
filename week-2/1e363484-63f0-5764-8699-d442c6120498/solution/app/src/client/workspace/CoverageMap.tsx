// The boundary map, drawn as a survey sheet on the project's local metre grid. Covered ground (the
// contributing footprints inside the boundary) carries the moss tint; the rest of the boundary keeps
// ink hatching. Each footprint is a toggle for its sensor.

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Point, Project } from "../types";
import { tide } from "./tween";

interface MapProps {
  project: Project;
  selected: string[];
  /** Contributing sensors of the preview on screen; null before any preview. */
  contributing: string[] | null;
  onToggle: (sensorId: string) => void;
}

const LABEL_PX = 12.5;

const svgPoints = (polygon: Point[]) => polygon.map(([x, y]) => `${x},${-y}`).join(" ");

function bounds(polygons: Point[][]) {
  const xs = polygons.flat().map((p) => p[0]);
  const ys = polygons.flat().map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function ticks(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(from / step) * step; v <= to; v += step) out.push(v);
  return out;
}

export function CoverageMap({ project, selected, contributing, onToggle }: MapProps) {
  const ids = useId().replace(/:/g, "");
  const tints = useRef(new Map<string, SVGPolygonElement>());
  const shown = useRef(new Map<string, number>());

  const svg = useRef<SVGSVGElement>(null);
  const [cssWidth, setCssWidth] = useState(400);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => entry && setCssWidth(entry.contentRect.width));
    observer.observe(svg.current!);
    return () => observer.disconnect();
  }, []);

  const box = bounds([project.boundary, ...project.sensors.map((s) => s.polygon)]);
  const width = box.maxX - box.minX, height = box.maxY - box.minY;
  // Labels stay about 12.5 px on screen: the map is (width + 4.8 font) units across `cssWidth` pixels.
  const font = (LABEL_PX * width) / Math.max(120, cssWidth - LABEL_PX * 4.8);
  const pad = { left: font * 3.4, right: font * 1.4, top: font * 1.6, bottom: font * 2.6 };
  const viewBox = [box.minX - pad.left, -box.maxY - pad.top, width + pad.left + pad.right, height + pad.top + pad.bottom].join(" ");
  const aspect = (width + pad.left + pad.right) / (height + pad.top + pad.bottom);
  const labelStep = width > 500 ? 200 : 100;
  const lastSelected = selected.length === 1 ? selected[0] : null;

  // The tide: tint each footprint toward covered (1) or hatching (0) when the preview on screen changes.
  const key = contributing?.join(",") ?? null;
  useLayoutEffect(() => {
    if (contributing === null) return;
    const from = new Map(shown.current);
    const first = from.size === 0;
    const apply = (progress: number) => {
      for (const sensor of project.sensors) {
        const target = contributing.includes(sensor.id) ? 1 : 0;
        const start = from.get(sensor.id) ?? 0;
        const value = first ? target : start + (target - start) * progress;
        shown.current.set(sensor.id, value);
        tints.current.get(sensor.id)?.style.setProperty("opacity", String(value));
      }
    };
    if (!first) return tide(apply);
    apply(1);
    return undefined;
  }, [key]); // the contributing set is identified by `key`

  const keyDown = (sensorId: string, disabled: boolean) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!disabled) onToggle(sensorId);
  };

  const ordered = [...project.sensors].sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === "satellite" ? -1 : 1));

  return (
    <section role="group" aria-label="Coverage map" className="pane map-pane">
      <h2 className="pane-title">Coverage map <span className="pane-unit">local grid, metres</span></h2>
      <svg ref={svg} viewBox={viewBox} className="survey-map" preserveAspectRatio="xMidYMid meet"
        style={{ fontSize: font, "--map-aspect": aspect } as React.CSSProperties}>
        <defs>
          <pattern id={`${ids}-hatch`} patternUnits="userSpaceOnUse" width={font * 0.42} height={font * 0.42} patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={font * 0.42} className="hatch-line" />
          </pattern>
          <clipPath id={`${ids}-boundary`}>
            <polygon points={svgPoints(project.boundary)} />
          </clipPath>
        </defs>

        <g aria-hidden="true">
          <polygon points={svgPoints(project.boundary)} fill={`url(#${ids}-hatch)`} className="uncovered" />
          <g clipPath={`url(#${ids}-boundary)`}>
            {project.sensors.map((s) => (
              <polygon
                key={s.id}
                points={svgPoints(s.polygon)}
                className="covered"
                ref={(el) => void (el ? tints.current.set(s.id, el) : tints.current.delete(s.id))}
                style={{ opacity: shown.current.get(s.id) ?? 0 }}
              />
            ))}
          </g>
          {ticks(box.minX, box.maxX, 100).map((x) => (
            <line key={`gx${x}`} x1={x} x2={x} y1={-box.minY + font * 0.4} y2={-box.maxY} className="grid-line" />
          ))}
          {ticks(box.minY, box.maxY, 100).map((y) => (
            <line key={`gy${y}`} x1={box.minX - font * 0.4} x2={box.maxX} y1={-y} y2={-y} className="grid-line" />
          ))}
          {ticks(box.minX, box.maxX, labelStep).map((x) => (
            <text key={`lx${x}`} x={x} y={-box.minY + font * 1.35} textAnchor="middle" className="axis-label">{x}</text>
          ))}
          {ticks(box.minY, box.maxY, labelStep).map((y) => (
            <text key={`ly${y}`} x={box.minX - font * 0.9} y={-y + font * 0.35} textAnchor="end" className="axis-label">{y}</text>
          ))}
          <text x={box.maxX} y={-box.minY + font * 2.4} textAnchor="end" className="axis-title">x (m)</text>
          <text x={box.minX - font * 0.9} y={-box.maxY - font * 0.75} textAnchor="end" className="axis-title">y (m)</text>
          <polygon points={svgPoints(project.boundary)} className="boundary-line" />
        </g>

        {ordered.map((s) => {
          const isSelected = selected.includes(s.id);
          const isContributing = contributing?.includes(s.id) ?? false;
          const disabled = s.id === lastSelected;
          const [x, y] = [Math.min(...s.polygon.map((p) => p[0])), Math.max(...s.polygon.map((p) => p[1]))];
          return (
            <g
              key={s.id}
              role="button"
              tabIndex={0}
              aria-label={`${s.id} footprint`}
              aria-pressed={isSelected}
              aria-disabled={disabled || undefined}
              className={`footprint footprint-${s.kind} ${isSelected ? (isContributing ? "is-contributing" : "is-faint") : "is-unselected"}`}
              onClick={() => !disabled && onToggle(s.id)}
              onKeyDown={keyDown(s.id, disabled)}
            >
              <polygon points={svgPoints(s.polygon)} className="footprint-shape" />
              <text x={x + font * 0.5} y={-y + font * 1.1} className="footprint-label" aria-hidden="true">{s.id}</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
