import { memo, useMemo, useRef, type ReactNode } from 'react';
import type { Station, StationKind } from '../../shared/types';

const WIDTH = 1000;
const HEIGHT = 290;

/** Stations follow loom order around a U-shaped line. */
const U_PATH: [number, number][] = [
  [92, 52],
  [92, 234],
  [908, 234],
  [908, 52],
];

function pointsAlongU(count: number): { x: number; y: number }[] {
  const segments = U_PATH.slice(0, -1).map((from, index) => {
    const to = U_PATH[index + 1];
    return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1]) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  const spots: { x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    let travel = (total * (index + 0.5)) / count;
    for (const segment of segments) {
      if (travel > segment.length) {
        travel -= segment.length;
        continue;
      }
      const ratio = segment.length === 0 ? 0 : travel / segment.length;
      spots.push({
        x: segment.from[0] + (segment.to[0] - segment.from[0]) * ratio,
        y: segment.from[1] + (segment.to[1] - segment.from[1]) * ratio,
      });
      break;
    }
  }
  return spots;
}

/** One shape per station kind, drawn as thin steel contours with no fills. */
function contour(kind: StationKind, x: number, y: number): ReactNode {
  switch (kind) {
    case 'oven':
      return (
        <>
          <rect className="contour" x={x - 30} y={y - 22} width={60} height={44} />
          <line className="contour" x1={x - 30} y1={y + 10} x2={x + 30} y2={y + 10} />
        </>
      );
    case 'mixer':
    case 'kettle':
      return <circle className="contour" cx={x} cy={y} r={21} />;
    case 'chiller':
    case 'cooler':
      return (
        <>
          <rect className="contour" x={x - 22} y={y - 22} width={44} height={44} />
          <path className="contour" d={`M ${x - 22} ${y + 22} A 44 44 0 0 1 ${x + 22} ${y + 22}`} />
        </>
      );
    case 'range':
      return (
        <>
          <rect className="contour" x={x - 32} y={y - 20} width={64} height={40} />
          {[
            [-17, -9],
            [11, -9],
            [-17, 9],
            [11, 9],
          ].map(([dx, dy]) => (
            <circle className="contour" key={`${dx}:${dy}`} cx={x + dx + 3} cy={y + dy} r={6.5} />
          ))}
        </>
      );
    case 'prep':
      return <rect className="contour" x={x - 42} y={y - 10} width={84} height={20} />;
  }
}

export const FloorPlan = memo(function FloorPlan({
  stations,
  lit,
}: {
  stations: Station[];
  lit: ReadonlySet<string>;
}): ReactNode {
  const spots = useMemo(() => pointsAlongU(stations.length), [stations.length]);
  const previous = useRef<ReadonlySet<string>>(new Set());

  const entering = stations.filter((s) => lit.has(s.id) && !previous.current.has(s.id)).map((s) => s.id);
  const leaving = stations.filter((s) => !lit.has(s.id) && previous.current.has(s.id)).map((s) => s.id);
  previous.current = lit;

  const delayFor = (stationId: string): number => {
    const joining = entering.indexOf(stationId);
    if (joining >= 0) return joining * 40;
    const going = leaving.indexOf(stationId);
    if (going >= 0) return (leaving.length - 1 - going) * 40;
    return 0;
  };

  return (
    <div className="floorband">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Kitchen floor plan">
        {stations.map((station, index) => {
          const spot = spots[index] ?? { x: WIDTH / 2, y: HEIGHT / 2 };
          const isLit = lit.has(station.id);
          const lag: Record<string, string> = { '--lag': `${delayFor(station.id)}ms` };
          return (
            <g
              key={station.id}
              className={isLit ? 'lit' : undefined}
              role="img"
              aria-label={isLit ? `${station.name}, lit` : station.name}
              style={lag}
            >
              {contour(station.kind, spot.x, spot.y)}
              <text className="station-name" x={spot.x} y={spot.y + 40}>
                {station.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
