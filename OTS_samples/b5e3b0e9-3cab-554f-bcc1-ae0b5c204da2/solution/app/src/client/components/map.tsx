import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import type { Layout, LayoutNode, LayoutSegment } from "../../shared/layout.ts";
import type { AircraftPosition } from "../../shared/wire.ts";
import { ditherFields } from "../dither.ts";

interface MapProps {
  /** The region's accessible name: `Airfield map`, or `Replay map` in the debrief. */
  name: string;
  layout: Layout;
  aircraft: AircraftPosition[];
  closed: boolean;
  litPreview: string[];
  litAccepted: string[];
  /** Places (segment or holding point ids) that would raise R4. */
  conflicts: string[];
  stopBars: string[];
  selected: string | null;
  emergency: string | null;
  glideMs: number;
  /** The text mirror is shown beneath the map, or kept for assistive technology only. */
  mirror?: "visible" | "hidden";
  onSelect?: (callsign: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const FINISHED = new Set(["airborne", "vacated"]);

function pointOf(node: LayoutNode | undefined): Point {
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

/** Where an aircraft is drawn: along its segment by progress, else at its node. */
function placeOf(nodes: Map<string, LayoutNode>, segments: Map<string, LayoutSegment>, a: AircraftPosition): Point | null {
  if (a.segment !== null) {
    const segment = segments.get(a.segment);
    if (!segment) return null;
    const start = pointOf(nodes.get(a.from ?? segment.from));
    const end = pointOf(nodes.get((a.from ?? segment.from) === segment.from ? segment.to : segment.from));
    const t = segment.lengthM === 0 ? 0 : a.progress / segment.lengthM;
    return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  }
  return a.node !== null ? pointOf(nodes.get(a.node)) : null;
}

function Symbol({ aircraft, place, selected, emergency, glideMs, onSelect }: {
  aircraft: AircraftPosition;
  place: Point;
  selected: boolean;
  emergency: boolean;
  glideMs: number;
  onSelect: ((callsign: string) => void) | undefined;
}) {
  const ref = useRef<SVGGElement>(null);
  const previous = useRef<Point | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const before = previous.current;
    previous.current = place;
    if (!element || !before || glideMs === 0 || (before.x === place.x && before.y === place.y)) return;
    element.animate(
      [{ transform: `translate(${before.x}px, ${before.y}px)` }, { transform: `translate(${place.x}px, ${place.y}px)` }],
      { duration: glideMs, easing: "linear" },
    );
  }, [place.x, place.y, glideMs]);
  const choose = (): void => onSelect?.(aircraft.callsign);
  return (
    <g
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Aircraft ${aircraft.callsign}`}
      class="symbol"
      data-aircraft-symbol={aircraft.callsign}
      data-status={aircraft.status}
      data-selected={selected ? "true" : "false"}
      data-emergency={emergency ? "true" : "false"}
      data-glide-ms={glideMs}
      style={{ transform: `translate(${place.x}px, ${place.y}px)` }}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          choose();
        }
      }}
    >
      <circle r="16" class="symbol-hit" />
      <path d="M0 -11 L9 9 L0 4 L-9 9 Z" class="symbol-body" />
      <text y="-17" class="symbol-label">
        {aircraft.callsign}
      </text>
    </g>
  );
}

/** The airfield as an inline SVG with the same objects listed as text beneath it. */
export function AirfieldMap(props: MapProps) {
  const { name, layout, aircraft, closed, litPreview, litAccepted, conflicts, stopBars, selected, emergency, glideMs, onSelect, mirror = "visible" } = props;
  const nodes = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const segments = useMemo(() => new Map(layout.segments.map((s) => [s.id, s])), [layout]);
  const fields = useMemo(() => ditherFields(layout), [layout]);
  const runway = layout.runways[0];
  const ends = runway?.thresholds.map((t) => pointOf(nodes.get(t.node))) ?? [];
  const visible = aircraft.filter((a) => !FINISHED.has(a.status));
  const places = visible.map((a) => ({ aircraft: a, place: placeOf(nodes, segments, a) }));
  const hatch = `url(#hatch-${name.replace(/\W+/g, "-")})`;
  const conflicted = (id: string): boolean => litPreview.includes(id) && conflicts.includes(id);
  const litState = (id: string): string | undefined =>
    conflicted(id) ? "preview" : litAccepted.includes(id) ? "accepted" : litPreview.includes(id) ? "preview" : undefined;

  return (
    <section class="map-region" role="region" aria-label={name}>
      <svg class="map" viewBox="-30 0 1060 500" preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${layout.name} schematic`}>
        <defs>
          <pattern id={`hatch-${name.replace(/\W+/g, "-")}`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" class="hatch-ground" />
            <rect width="4" height="10" class="hatch-bar" />
          </pattern>
        </defs>
        <path d={fields.grass} class="field-grass" />
        <path d={fields.apron} class="field-apron" />
        {runway && ends.length === 2 && (
          <g data-runway={runway.id} data-closed={closed ? "true" : "false"}>
            <line x1={ends[0]?.x} y1={ends[0]?.y} x2={ends[1]?.x} y2={ends[1]?.y} class="runway" />
            <line x1={ends[0]?.x} y1={ends[0]?.y} x2={ends[1]?.x} y2={ends[1]?.y} class="runway-centre" />
            {closed && <line x1={ends[0]?.x} y1={ends[0]?.y} x2={ends[1]?.x} y2={ends[1]?.y} class="runway-closed" style={{ stroke: hatch }} />}
            <text x={((ends[0]?.x ?? 0) + (ends[1]?.x ?? 0)) / 2} y={(ends[0]?.y ?? 0) - 20} class="map-label">
              {runway.id}
            </text>
            {runway.thresholds.map((t, i) => (
              <text key={t.id} x={(ends[i]?.x ?? 0) + (i === 0 ? -6 : 6)} y={(ends[i]?.y ?? 0) + 4} class="map-label" text-anchor={i === 0 ? "end" : "start"}>
                {t.id}
              </text>
            ))}
            {closed && (
              <text x={((ends[0]?.x ?? 0) + (ends[1]?.x ?? 0)) / 2} y={(ends[0]?.y ?? 0) + 5} class="closed-word" text-anchor="middle">
                CLOSED
              </text>
            )}
          </g>
        )}
        {layout.segments.map((segment) => {
          const start = pointOf(nodes.get(segment.from));
          const end = pointOf(nodes.get(segment.to));
          return (
            <g key={segment.id}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                class="segment"
                data-segment-id={segment.id}
                data-lit={litState(segment.id)}
                data-conflict={conflicted(segment.id) ? "R4" : undefined}
                style={conflicted(segment.id) ? { stroke: hatch } : undefined}
              />
              <text x={(start.x + end.x) / 2 + 8} y={(start.y + end.y) / 2 - 8} class="map-label">
                {segment.id}
              </text>
            </g>
          );
        })}
        {layout.nodes
          .filter((n) => n.kind === "holding")
          .map((n) => (
            <g
              key={n.id}
              class="holding"
              data-holding={n.id}
              data-stop-bar={stopBars.includes(n.id) ? "true" : undefined}
              data-conflict={conflicts.includes(n.id) && stopBars.includes(n.id) ? "R4" : undefined}
              transform={`translate(${n.x} ${n.y})`}
            >
              <rect
                x="-7"
                y="-7"
                width="14"
                height="14"
                class="holding-mark"
                style={conflicts.includes(n.id) && stopBars.includes(n.id) ? { fill: hatch } : undefined}
              />
              <rect x="-20" y="-3" width="40" height="6" class="stop-bar" />
              <text y="22" class="map-label" text-anchor="middle">
                {n.id}
              </text>
            </g>
          ))}
        {layout.nodes
          .filter((n) => n.kind === "stand")
          .map((n) => (
            <g key={n.id} class="stand" data-stand={n.id} transform={`translate(${n.x} ${n.y})`}>
              <rect x="-9" y="-9" width="18" height="18" class="stand-mark" />
              <text y="24" class="map-label" text-anchor="middle">
                {n.id}
              </text>
            </g>
          ))}
        {places.map(({ aircraft: a, place }) =>
          place ? (
            <Symbol
              key={a.callsign}
              aircraft={a}
              place={place}
              selected={selected === a.callsign}
              emergency={emergency === a.callsign}
              glideMs={glideMs}
              onSelect={onSelect}
            />
          ) : null,
        )}
      </svg>
      <div class={mirror === "visible" ? "map-mirror" : "map-mirror sr-only"}>
        <ul aria-label="Airfield objects" class="mirror-objects">
          {runway && (
            <li data-runway={runway.id}>
              <span>{runway.id}</span>
            </li>
          )}
          {layout.segments.map((s) => (
            <li key={s.id} data-segment-id={s.id}>
              {s.id}
            </li>
          ))}
          {layout.nodes
            .filter((n) => n.kind === "holding")
            .map((n) => (
              <li key={n.id} data-holding={n.id}>
                {n.id}
              </li>
            ))}
          {layout.nodes
            .filter((n) => n.kind === "stand")
            .map((n) => (
              <li key={n.id} data-stand={n.id}>
                {n.id}
              </li>
            ))}
        </ul>
        <ul aria-label="Aircraft positions" class="mirror-aircraft">
          {aircraft.map((a) => (
            <li
              key={a.callsign}
              data-aircraft={a.callsign}
              data-status={a.status}
              data-segment={a.segment ?? ""}
              data-node={a.node ?? ""}
              data-progress={a.progress}
            >
              {`${a.callsign} ${a.status} ${a.segment ?? a.node ?? ""}`}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
