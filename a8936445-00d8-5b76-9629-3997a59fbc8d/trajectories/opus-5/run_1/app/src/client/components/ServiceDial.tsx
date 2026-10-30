import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatMinuteOfDay } from '../kitchenTime';

export type StationState = 'free' | 'booked' | 'held' | 'cleaning';

export interface StationTile {
  id: string;
  name: string;
  state: StationState;
  tileLabel: string;
  accessibleName: string;
}

const CENTRE = 200;
const RING_RADIUS = 172;
const TRACK_WIDTH = 22;
const HANDLE_VISUAL = 13;
const HANDLE_TARGET = 26;
const STEP = 15;
const MAX_ARC_MINUTES = 480;

interface TileBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TILE_BOXES: TileBox[] = [
  { id: 'hot-line-1', x: 84, y: 96, width: 108, height: 50 },
  { id: 'hot-line-2', x: 208, y: 96, width: 108, height: 50 },
  { id: 'bake-deck', x: 74, y: 174, width: 74, height: 52 },
  { id: 'cold-prep-a', x: 84, y: 254, width: 108, height: 50 },
  { id: 'cold-prep-b', x: 208, y: 254, width: 108, height: 50 },
];

const WALK_IN = { x: 252, y: 174, width: 74, height: 52 };

function pointAt(minute: number, radius: number): { x: number; y: number } {
  const radians = (minute * 0.25 * Math.PI) / 180;
  return { x: CENTRE + radius * Math.sin(radians), y: CENTRE - radius * Math.cos(radians) };
}

function arcPath(startMinute: number, endMinute: number, radius: number): string {
  const start = pointAt(startMinute, radius);
  const end = pointAt(endMinute, radius);
  const largeArc = endMinute - startMinute > 720 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function fillFor(state: StationState): string {
  if (state === 'booked') return 'var(--ink)';
  if (state === 'held') return 'url(#pattern-held)';
  if (state === 'cleaning') return 'url(#pattern-cleaning)';
  return 'url(#pattern-free)';
}

/** Keeps rotation continuous so the handle always takes the shorter way round. */
function useContinuousAngle(value: number): number {
  const [angle, setAngle] = useState(value * 0.25);
  const current = useRef(value * 0.25);
  useEffect(() => {
    const target = value * 0.25;
    const delta = ((target - (current.current % 360) + 540) % 360) - 180;
    current.current += delta;
    setAngle(current.current);
  }, [value]);
  return angle;
}

export interface DialArc {
  start: number;
  end: number;
  pending: boolean;
}

export interface ServiceDialProps {
  value: number;
  onValue: (minute: number) => void;
  tiles: StationTile[];
  selectedStationId: string | null;
  onSelectStation: (id: string) => void;
  openCount: number;
  stationCount: number;
  displayedValue: number;
  displayedOpenCount: number;
  rolling: boolean;
  fadingTiles: boolean;
  reducedMotion: boolean;
  arcEnabled: boolean;
  arc: DialArc | null;
  onArcChange: (arc: { start: number; end: number } | null) => void;
  onArcRelease: (arc: { start: number; end: number }) => void;
}

export function ServiceDial(props: ServiceDialProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragMode = useRef<'handle' | 'arc' | null>(null);
  const arcAnchor = useRef(0);
  const angle = useContinuousAngle(props.value);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? STEP : -STEP;
      latest.current.onValue(Math.min(1440, Math.max(0, latest.current.value + delta)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const minuteFromEvent = (event: { clientX: number; clientY: number }): number => {
    const svg = svgRef.current;
    if (!svg) return props.value;
    const box = svg.getBoundingClientRect();
    const scale = 400 / box.width;
    const x = (event.clientX - box.left) * scale - CENTRE;
    const y = (event.clientY - box.top) * scale - CENTRE;
    let degrees = (Math.atan2(x, -y) * 180) / Math.PI;
    if (degrees < 0) degrees += 360;
    return Math.min(1440, Math.max(0, Math.round((degrees * 4) / STEP) * STEP));
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const deltas: Record<string, number> = {
      ArrowRight: STEP,
      ArrowUp: STEP,
      ArrowLeft: -STEP,
      ArrowDown: -STEP,
      PageUp: 60,
      PageDown: -60,
    };
    if (event.key === 'Home') {
      event.preventDefault();
      props.onValue(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      props.onValue(1440);
      return;
    }
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    props.onValue(Math.min(1440, Math.max(0, props.value + delta)));
  };

  const beginHandleDrag = (event: ReactPointerEvent): void => {
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragMode.current = 'handle';
  };

  const beginTrackPress = (event: ReactPointerEvent): void => {
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    const minute = minuteFromEvent(event);
    if (!props.arcEnabled || props.reducedMotion) {
      dragMode.current = 'handle';
      props.onValue(minute);
      return;
    }
    dragMode.current = 'arc';
    arcAnchor.current = minute;
    props.onArcChange({ start: minute, end: minute });
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    if (dragMode.current === null) return;
    const minute = minuteFromEvent(event);
    if (dragMode.current === 'handle') {
      props.onValue(minute);
      return;
    }
    const anchor = arcAnchor.current;
    const forward = minute >= anchor;
    const span = Math.min(Math.abs(minute - anchor), MAX_ARC_MINUTES);
    const start = forward ? anchor : anchor - span;
    props.onArcChange({ start, end: start + span });
  };

  const endDrag = (): void => {
    const mode = dragMode.current;
    dragMode.current = null;
    if (mode === 'arc' && props.arc) {
      props.onArcRelease({ start: props.arc.start, end: props.arc.end });
    }
  };

  const ticks = Array.from({ length: 24 }, (_, hour) => hour * 60);
  const valueText = `${formatMinuteOfDay(props.value)}, ${props.openCount} of ${props.stationCount} open`;

  return (
    <svg
      ref={svgRef}
      className="dial-svg"
      viewBox="0 0 400 400"
      aria-label="Kitchen floor plan and service dial"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <defs>
        <pattern id="pattern-free" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="var(--surface)" />
          <path d="M0 8 L8 0" stroke="var(--ink-soft)" strokeWidth="1" />
        </pattern>
        <pattern id="pattern-held" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="var(--surface)" />
          <circle cx="2" cy="2" r="1.7" fill="var(--held)" />
          <circle cx="6" cy="6" r="1.7" fill="var(--held)" />
        </pattern>
        <pattern id="pattern-cleaning" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="var(--surface)" />
          <path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" stroke="var(--ink)" strokeWidth="2.6" />
        </pattern>
      </defs>

      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={RING_RADIUS}
        fill="none"
        stroke="var(--track)"
        strokeWidth={TRACK_WIDTH}
        style={{ cursor: 'pointer' }}
        onPointerDown={beginTrackPress}
      />
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={RING_RADIUS + TRACK_WIDTH / 2}
        fill="none"
        stroke="var(--rule)"
        strokeWidth="1.5"
        pointerEvents="none"
      />
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={RING_RADIUS - TRACK_WIDTH / 2}
        fill="none"
        stroke="var(--rule)"
        strokeWidth="1.5"
        pointerEvents="none"
      />

      {ticks.map((minute) => {
        const outer = pointAt(minute, RING_RADIUS + 11);
        const inner = pointAt(minute, RING_RADIUS - (minute % 360 === 0 ? 11 : 6));
        return (
          <line
            key={minute}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="var(--ink)"
            strokeWidth={minute % 360 === 0 ? 2.4 : 1.4}
            pointerEvents="none"
          />
        );
      })}

      {props.arc && props.arc.end > props.arc.start ? (
        <path
          d={arcPath(props.arc.start, props.arc.end, RING_RADIUS)}
          fill="none"
          stroke={props.arc.pending ? 'var(--accent)' : 'var(--held)'}
          strokeWidth={TRACK_WIDTH}
          className={props.arc.pending ? 'arc-pending' : undefined}
          pointerEvents="none"
        />
      ) : null}

      <g
        role="slider"
        aria-label="Service dial"
        aria-valuemin={0}
        aria-valuemax={1440}
        aria-valuenow={props.value}
        aria-valuetext={valueText}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={beginHandleDrag}
        style={{ cursor: 'grab' }}
      >
        <g className="dial-handle" transform={`rotate(${angle} ${CENTRE} ${CENTRE})`}>
          <circle cx={CENTRE} cy={CENTRE - RING_RADIUS} r={HANDLE_TARGET} fill="transparent" />
          <circle
            cx={CENTRE}
            cy={CENTRE - RING_RADIUS}
            r={HANDLE_VISUAL}
            fill="var(--accent)"
            stroke="var(--ink)"
            strokeWidth="2"
          />
        </g>
      </g>

      <g role="group" aria-label="Floor plan">
        <rect
          x={WALK_IN.x}
          y={WALK_IN.y}
          width={WALK_IN.width}
          height={WALK_IN.height}
          fill="var(--surface)"
          stroke="var(--rule)"
          strokeDasharray="4 3"
        />
        <text
          x={WALK_IN.x + WALK_IN.width / 2}
          y={WALK_IN.y + 22}
          textAnchor="middle"
          fontSize="11"
          fill="var(--ink-soft)"
        >
          Walk-in
        </text>
        <text
          x={WALK_IN.x + WALK_IN.width / 2}
          y={WALK_IN.y + 38}
          textAnchor="middle"
          fontSize="11"
          fill="var(--ink-soft)"
        >
          storage
        </text>

        {TILE_BOXES.map((box) => {
          const tile = props.tiles.find((candidate) => candidate.id === box.id);
          if (!tile) return null;
          const selected = props.selectedStationId === tile.id;
          const labelColour = tile.state === 'booked' ? 'var(--surface)' : 'var(--ink)';
          return (
            <g
              key={box.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={tile.accessibleName}
              style={{ cursor: 'pointer' }}
              onClick={() => props.onSelectStation(tile.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  props.onSelectStation(tile.id);
                }
              }}
            >
              <g className={`tile-face${props.fadingTiles ? ' fading' : ''}`}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  fill={fillFor(tile.state)}
                  stroke={selected ? 'var(--accent)' : 'var(--ink)'}
                  strokeWidth={selected ? 3 : 1.4}
                />
                <text
                  x={box.x + box.width / 2}
                  y={box.y + 20}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill={labelColour}
                >
                  {tile.name}
                </text>
                <text
                  x={box.x + box.width / 2}
                  y={box.y + box.height - 10}
                  textAnchor="middle"
                  fontSize="12"
                  fontFamily="var(--mono)"
                  fill={labelColour}
                >
                  {tile.tileLabel}
                </text>
              </g>
            </g>
          );
        })}
      </g>

      <g className="dial-spoke" transform={`rotate(${angle} ${CENTRE} ${CENTRE})`} pointerEvents="none">
        <line
          x1={CENTRE}
          y1={CENTRE}
          x2={CENTRE}
          y2={CENTRE - RING_RADIUS}
          stroke="var(--accent)"
          strokeWidth="3"
        />
      </g>

      <circle cx={CENTRE} cy={CENTRE} r="48" fill="var(--surface)" stroke="var(--rule)" />
      <text
        x={CENTRE}
        y={CENTRE - 2}
        textAnchor="middle"
        fontSize="22"
        fontFamily="var(--mono)"
        fill="var(--ink)"
        className={`readout-time${props.rolling ? ' readout-rolling' : ''}`}
      >
        {formatMinuteOfDay(props.displayedValue)}
      </text>
      <text
        x={CENTRE}
        y={CENTRE + 20}
        textAnchor="middle"
        fontSize="12"
        fontFamily="var(--mono)"
        fill="var(--ink-soft)"
        className={`readout-count${props.rolling ? ' readout-rolling' : ''}`}
      >
        {props.displayedOpenCount} of {props.stationCount} open
      </text>

    </svg>
  );
}
