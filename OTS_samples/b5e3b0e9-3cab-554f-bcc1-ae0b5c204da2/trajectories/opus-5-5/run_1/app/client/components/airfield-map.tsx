import type { AircraftPosition, Layout, LayoutNode } from '../../shared/types.js';

export interface MapAircraft extends AircraftPosition {
  emergency?: boolean;
}

export interface MapProps {
  layout: Layout;
  aircraft: MapAircraft[];
  label?: string;
  closed?: boolean;
  selected?: string | null;
  glideMs?: number;
  lit?: Record<string, 'preview' | 'accepted'>;
  conflicts?: Set<string>;
  stopBars?: Set<string>;
  onAircraft?: (callsign: string) => void;
}

const HIDDEN_STATUSES = ['airborne', 'vacated'];

function point(nodes: Map<string, LayoutNode>, aircraft: MapAircraft, layout: Layout): { x: number; y: number } | null {
  if (aircraft.segment) {
    const segment = layout.segments.find((item) => item.id === aircraft.segment);
    if (!segment) return null;
    const fromId = aircraft.from ?? segment.from;
    const toId = fromId === segment.from ? segment.to : segment.from;
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) return null;
    const share = segment.lengthM > 0 ? Math.min(1, aircraft.progress / segment.lengthM) : 0;
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
  }
  const node = aircraft.node ? nodes.get(aircraft.node) : undefined;
  return node ? { x: node.x, y: node.y } : null;
}

export function AirfieldMap(props: MapProps) {
  const { layout } = props;
  const nodes = new Map(layout.nodes.map((node) => [node.id, node] as const));
  const lit = props.lit ?? {};
  const conflicts = props.conflicts ?? new Set<string>();
  const stopBars = props.stopBars ?? new Set<string>();
  const glide = props.glideMs ?? 0;
  const label = props.label ?? 'Airfield map';
  const patternId = `dither-${label.replace(/\W/g, '')}`;
  const hatchId = `hatch-${label.replace(/\W/g, '')}`;
  return (
    <section aria-label={label} class="map-region">
      <svg viewBox="0 0 1000 500" class="airfield" role="group" aria-label={`${layout.name} diagram`}>
        <defs>
          <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="2" height="2" class="dither" />
            <rect x="4" y="4" width="2" height="2" class="dither" />
            <rect x="4" y="0" width="1" height="1" class="dither faint" />
            <rect x="0" y="4" width="1" height="1" class="dither faint" />
          </pattern>
          <pattern id={hatchId} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="3" height="10" class="hatch-stroke" />
          </pattern>
          <radialGradient id={`${patternId}-fade`}>
            <stop offset="0%" stop-color="#ff8cc6" stop-opacity="1" />
            <stop offset="100%" stop-color="#ff8cc6" stop-opacity="0" />
          </radialGradient>
          <mask id={`${patternId}-mask`}>
            <rect x="0" y="0" width="1000" height="500" fill={`url(#${patternId}-fade)`} />
          </mask>
        </defs>
        <rect x="0" y="0" width="1000" height="500" fill={`url(#${patternId})`} mask={`url(#${patternId}-mask)`} />
        {layout.runways.map((runway) => {
          const ends = runway.thresholds.map((threshold) => nodes.get(threshold.node)).filter((n): n is LayoutNode => Boolean(n));
          if (ends.length < 2) return null;
          const [a, b] = [ends[0]!, ends[1]!];
          return (
            <g key={runway.id} data-runway={runway.id} class={`runway${props.closed ? ' closed' : ''}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="runway-body" />
              {props.closed ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="runway-hatch" stroke={`url(#${hatchId})`} /> : null}
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 22} text-anchor="middle" class="map-label">
                {runway.id}
              </text>
              {props.closed ? (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 6} text-anchor="middle" class="closed-label">
                  CLOSED
                </text>
              ) : null}
              {runway.thresholds.map((threshold) => {
                const node = nodes.get(threshold.node);
                return node ? (
                  <text key={threshold.id} x={node.x} y={node.y + 34} text-anchor="middle" class="map-label small">
                    {threshold.id}
                  </text>
                ) : null;
              })}
            </g>
          );
        })}
        {layout.segments.map((segment) => {
          const a = nodes.get(segment.from);
          const b = nodes.get(segment.to);
          if (!a || !b) return null;
          const state = lit[segment.id];
          const conflict = state === 'preview' && conflicts.has(segment.id);
          return (
            <g
              key={segment.id}
              data-segment-id={segment.id}
              data-lit={state}
              data-conflict={conflict ? 'R4' : undefined}
              class="segment"
            >
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="segment-line" />
              {conflict ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="segment-conflict" /> : null}
              <text x={(a.x + b.x) / 2 + 8} y={(a.y + b.y) / 2 - 8} class="map-label small">
                {segment.id}
              </text>
            </g>
          );
        })}
        {layout.nodes
          .filter((node) => node.kind === 'stand')
          .map((node) => (
            <g key={node.id} data-stand={node.id} class="stand">
              <rect x={node.x - 14} y={node.y - 10} width="28" height="20" />
              <text x={node.x} y={node.y + 30} text-anchor="middle" class="map-label small">
                {node.id}
              </text>
            </g>
          ))}
        {layout.nodes
          .filter((node) => node.kind === 'holding')
          .map((node) => (
            <g
              key={node.id}
              data-holding={node.id}
              data-stop-bar={stopBars.has(node.id) ? 'true' : undefined}
              data-conflict={conflicts.has(node.id) ? 'R4' : undefined}
              class="holding"
            >
              <rect x={node.x - 16} y={node.y - 4} width="32" height="8" class="holding-bar" />
              <text x={node.x} y={node.y - 12} text-anchor="middle" class="map-label small">
                {node.id}
              </text>
            </g>
          ))}
        {props.aircraft
          .filter((aircraft) => !HIDDEN_STATUSES.includes(aircraft.status))
          .map((aircraft) => {
            const at = point(nodes, aircraft, layout);
            if (!at) return null;
            const selected = props.selected === aircraft.callsign;
            return (
              <g
                key={aircraft.callsign}
                role="button"
                tabIndex={0}
                aria-label={`Aircraft ${aircraft.callsign}`}
                class="aircraft"
                data-selected={selected ? 'true' : 'false'}
                data-emergency={aircraft.emergency ? 'true' : 'false'}
                data-glide-ms={String(glide)}
                style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDuration: `${glide}ms` }}
                onClick={() => props.onAircraft?.(aircraft.callsign)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    props.onAircraft?.(aircraft.callsign);
                  }
                }}
              >
                <circle r="22" class="aircraft-hit" />
                <path d="M0,-10 L8,8 L0,4 L-8,8 Z" class="aircraft-shape" />
                <text x="12" y="-10" class="aircraft-label">
                  {aircraft.callsign}
                </text>
              </g>
            );
          })}
      </svg>
      <div class="mirror">
        <ul aria-label="Airfield objects" class="mirror-list">
          {layout.runways.map((runway) => (
            <li key={`r-${runway.id}`} data-runway={runway.id}>
              {runway.id}
            </li>
          ))}
          {layout.segments.map((segment) => (
            <li key={`s-${segment.id}`} data-segment-id={segment.id}>
              {segment.id}
            </li>
          ))}
          {layout.nodes
            .filter((node) => node.kind === 'holding')
            .map((node) => (
              <li key={`h-${node.id}`} data-holding={node.id}>
                {node.id}
              </li>
            ))}
          {layout.nodes
            .filter((node) => node.kind === 'stand')
            .map((node) => (
              <li key={`p-${node.id}`} data-stand={node.id}>
                {node.id}
              </li>
            ))}
        </ul>
        <ul aria-label="Aircraft positions" class="mirror-list">
          {props.aircraft.map((aircraft) => (
            <li
              key={aircraft.callsign}
              data-aircraft={aircraft.callsign}
              data-status={aircraft.status}
              data-segment={aircraft.segment ?? ''}
              data-node={aircraft.node ?? ''}
              data-progress={String(aircraft.progress)}
            >
              {`${aircraft.callsign} ${aircraft.status} ${aircraft.segment ?? aircraft.node ?? ''}`}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
