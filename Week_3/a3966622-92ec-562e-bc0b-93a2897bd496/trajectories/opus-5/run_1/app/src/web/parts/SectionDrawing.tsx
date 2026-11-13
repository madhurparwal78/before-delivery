import { useEffect, useRef, useState } from 'react';
import { BERTH_NM } from '../../domain/route.ts';
import { marginFromMm, metresFromMm, waterDepthMm } from '../format.ts';
import type { Move, Plan } from '../types.ts';

const TOP_METRES = 10.5;
const BOTTOM_METRES = -8.5;
const NAME_BAND = 14;
const LIMIT_BAND = 28;
const HULL_LENGTH_NM = 2.2;
const HULL_FREEBOARD_M = 1.6;

/** The water line changes at once, each bar and its numerals follow, the pinch marker settles last. */
const BAR_MOTION: React.CSSProperties = {
  transition: 'y 0.18s ease-out 0.12s, height 0.18s ease-out 0.12s, fill 0.18s ease-out 0.12s',
};
const NUMERAL_MOTION: React.CSSProperties = { transition: 'y 0.18s ease-out 0.12s' };
const PINCH_MOTION: React.CSSProperties = { transition: 'transform 0.13s ease-out 0.2s' };
const WATER_MOTION: React.CSSProperties = { transition: 'points 0.12s ease-out' };
const HULL_MOTION: React.CSSProperties = {
  transition: 'transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)',
};

/** A to-scale long section: seabed, water line at each waypoint, six bars and the hull. */
export function SectionDrawing({
  plan,
  move,
  progress,
}: {
  plan: Plan | null;
  move: Move | null;
  progress: number;
}): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 200 });

  useEffect(() => {
    const node = box.current;
    if (node === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(120, entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const seaTop = LIMIT_BAND;
  const seaBottom = height - 2;
  const x = (distanceNm: number): number => (distanceNm / BERTH_NM) * width;
  const y = (metres: number): number =>
    seaTop + ((TOP_METRES - metres) / (TOP_METRES - BOTTOM_METRES)) * (seaBottom - seaTop);

  const waypoints = plan?.waypoints ?? [];
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const waterPoints =
    first === undefined || last === undefined
      ? ''
      : [
          `0,${y(first.tide_mm / 1000)}`,
          ...waypoints.map((waypoint) => `${x(waypoint.distance_nm)},${y(waypoint.tide_mm / 1000)}`),
          `${width},${y(last.tide_mm / 1000)}`,
        ].join(' ');

  const seabed: string[] = [];
  waypoints.forEach((waypoint, index) => {
    const previous = index === 0 ? 0 : (waypoints[index - 1] as { distance_nm: number }).distance_nm;
    const from = index === 0 ? 0 : (previous + waypoint.distance_nm) / 2;
    const next = waypoints[index + 1];
    const to = next === undefined ? BERTH_NM : (waypoint.distance_nm + next.distance_nm) / 2;
    const depth = y(-waypoint.sounded_depth_mm / 1000);
    seabed.push(`${x(from)},${depth}`, `${x(to)},${depth}`);
  });

  const pinch = waypoints.find((waypoint) => waypoint.pinch);
  const hullWater = first === undefined ? 0 : first.tide_mm / 1000;
  const hullDraught = move === null ? 0 : (move.draught_mm + (first?.squat_mm ?? 0)) / 1000;
  const hullTop = y(hullWater + HULL_FREEBOARD_M);
  const hullBottom = y(hullWater - hullDraught);
  const hullWidth = x(HULL_LENGTH_NM);
  const hullLeft = (progress / 100) * (width - hullWidth);

  return (
    <div className="keel-figure" ref={box}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" aria-hidden="true">
        <rect x={0} y={0} width={width} height={height} fill="#040d0d" />
        {waterPoints !== '' && (
          <>
            <polygon
              points={`${waterPoints} ${width},${seaBottom} 0,${seaBottom}`}
              fill="#0b3331"
            />
            <polyline
              data-testid="water-line"
              data-heights-mm={waypoints.map((waypoint) => waterDepthMm(waypoint)).join(',')}
              points={waterPoints}
              fill="none"
              stroke="#49bdb0"
              strokeWidth="2"
              style={WATER_MOTION}
            />
          </>
        )}
        {seabed.length > 0 && (
          <>
            <polygon
              points={`${seabed.join(' ')} ${width},${seaBottom} 0,${seaBottom}`}
              fill="#14100a"
            />
            <polyline points={seabed.join(' ')} fill="none" stroke="#8d7850" strokeWidth="2" />
          </>
        )}
        {waypoints.map((waypoint, index) => {
          const top = y(waypoint.tide_mm / 1000);
          const bottom = y(-waypoint.sounded_depth_mm / 1000);
          const narrow = width < 560;
          return (
            <g key={waypoint.id}>
              <rect
                data-testid={`bar-${waypoint.id}`}
                data-margin-mm={waypoint.margin_mm}
                x={x(waypoint.distance_nm) - 5}
                y={top}
                width={10}
                height={Math.max(2, bottom - top)}
                fill={waypoint.margin_mm < 0 ? '#ff6f5e' : '#1b8f86'}
                style={BAR_MOTION}
              />
              <text
                x={x(waypoint.distance_nm)}
                y={narrow && index % 2 === 1 ? NAME_BAND + 8 : NAME_BAND - 2}
                fill="#d7e5ea"
                fontSize={narrow ? 9 : 12}
                textAnchor="middle"
                fontFamily="Saira Condensed, sans-serif"
              >
                {waypoint.name}
              </text>
              {!narrow && (
                <text
                  x={x(waypoint.distance_nm)}
                  y={bottom - 4}
                  fill={waypoint.margin_mm < 0 ? '#ff6f5e' : '#d7e5ea'}
                  fontSize="11"
                  textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace"
                  style={NUMERAL_MOTION}
                >
                  {`${marginFromMm(waypoint.margin_mm)} m`}
                </text>
              )}
              {waypoint.speed_limit_kn !== null && (
                <text
                  x={x(waypoint.distance_nm) - x(0.9)}
                  y={LIMIT_BAND - 4}
                  fill="#f2ab3c"
                  fontSize={narrow ? 9 : 11}
                  textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {`${waypoint.speed_limit_kn} kn`}
                </text>
              )}
            </g>
          );
        })}
        {pinch !== undefined && (
          <polygon
            data-testid="pinch-marker"
            points="-6,-10 6,-10 0,0"
            fill="#f2ab3c"
            style={PINCH_MOTION}
            transform={`translate(${x(pinch.distance_nm)} ${y(pinch.tide_mm / 1000) - 2})`}
          />
        )}
        {first !== undefined && move !== null && (
          <g
            data-testid="hull"
            data-progress={Math.round(progress)}
            style={HULL_MOTION}
            transform={`translate(${hullLeft} 0)`}
          >
            <polygon
              points={`0,${hullTop} ${hullWidth},${hullTop} ${hullWidth - 10},${hullBottom} 10,${hullBottom}`}
              fill="#16302f"
              stroke="#d7e5ea"
              strokeWidth="1.5"
            />
            <text
              x={hullWidth / 2}
              y={(hullTop + hullBottom) / 2 + 4}
              fill="#d7e5ea"
              fontSize="11"
              textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace"
            >
              {`${metresFromMm(move.draught_mm)} m`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
