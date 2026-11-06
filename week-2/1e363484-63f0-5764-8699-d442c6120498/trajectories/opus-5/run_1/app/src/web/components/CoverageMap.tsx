import type { Sensor } from '../api';

export interface CoverageMapProps {
  readonly boundary: readonly [number, number][];
  readonly sensors: readonly Sensor[];
  readonly selected: readonly string[];
  readonly contributing: readonly string[];
  readonly onToggle: (sensorId: string) => void;
  readonly lastSelected: string | null;
}

const GRID_METRES = 100;

function bounds(points: readonly [number, number][]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** The boundary map, drawn as a survey sheet on the project's local metre grid. */
export function CoverageMap(props: CoverageMapProps): React.ReactElement {
  const box = bounds(props.boundary);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const pad = Math.max(60, Math.max(width, height) * 0.08);
  const viewWidth = width + pad * 2;
  const viewHeight = height + pad * 2;

  const toX = (x: number): number => x - box.minX;
  const toY = (y: number): number => box.maxY - y;
  const path = (points: readonly [number, number][]): string =>
    `${points.map((point) => `${toX(point[0])},${toY(point[1])}`).join(' ')}`;

  const gridXs: number[] = [];
  for (let x = Math.ceil(box.minX / GRID_METRES) * GRID_METRES; x <= box.maxX; x += GRID_METRES) {
    gridXs.push(x);
  }
  const gridYs: number[] = [];
  for (let y = Math.ceil(box.minY / GRID_METRES) * GRID_METRES; y <= box.maxY; y += GRID_METRES) {
    gridYs.push(y);
  }

  const centroid = (points: readonly [number, number][]): { x: number; y: number } => {
    const inner = bounds(points);
    return { x: (inner.minX + inner.maxX) / 2, y: (inner.minY + inner.maxY) / 2 };
  };

  return (
    <section className="panel" role="group" aria-label="Coverage map">
      <div className="map-wrap">
        <svg
          viewBox={`${-pad} ${-pad} ${viewWidth} ${viewHeight}`}
          role="img"
          aria-label="Project boundary with sensor footprints"
        >
          <defs>
            <pattern
              id="survey-hatch"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--ink)" strokeWidth="0.9" />
            </pattern>
            <clipPath id="boundary-clip">
              <polygon points={path(props.boundary)} />
            </clipPath>
          </defs>

          {gridXs.map((x) => (
            <line
              key={`gx-${x}`}
              x1={toX(x)}
              y1={0}
              x2={toX(x)}
              y2={height}
              stroke="var(--ink)"
              strokeWidth="0.5"
              opacity="0.18"
            />
          ))}
          {gridYs.map((y) => (
            <line
              key={`gy-${y}`}
              x1={0}
              y1={toY(y)}
              x2={width}
              y2={toY(y)}
              stroke="var(--ink)"
              strokeWidth="0.5"
              opacity="0.18"
            />
          ))}

          {gridXs.map((x) => (
            <text
              key={`tx-${x}`}
              x={toX(x)}
              y={height + pad * 0.6}
              fontSize={pad * 0.3}
              textAnchor="middle"
              fill="var(--ink)"
              fontFamily="IBM Plex Mono, monospace"
            >
              {x}
            </text>
          ))}
          {gridYs.map((y) => (
            <text
              key={`ty-${y}`}
              x={-pad * 0.2}
              y={toY(y)}
              fontSize={pad * 0.3}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--ink)"
              fontFamily="IBM Plex Mono, monospace"
            >
              {y}
            </text>
          ))}
          <text
            x={width / 2}
            y={height + pad * 0.95}
            fontSize={pad * 0.3}
            textAnchor="middle"
            fill="var(--ink)"
          >
            metres east
          </text>
          <text
            x={-pad * 0.75}
            y={height / 2}
            fontSize={pad * 0.3}
            textAnchor="middle"
            fill="var(--ink)"
            transform={`rotate(-90 ${-pad * 0.75} ${height / 2})`}
          >
            metres north
          </text>

          <polygon points={path(props.boundary)} fill="url(#survey-hatch)" opacity="0.5" />

          <g clipPath="url(#boundary-clip)">
            {props.sensors.map((sensor) => {
              const isSelected = props.selected.includes(sensor.id);
              const isContributing = props.contributing.includes(sensor.id);
              return (
                <polygon
                  key={`fill-${sensor.id}`}
                  points={path(sensor.polygon)}
                  fill="var(--covered)"
                  fillOpacity={isSelected && isContributing ? 0.85 : 0}
                  style={{ transition: 'fill-opacity 450ms ease-out' }}
                />
              );
            })}
          </g>

          <polygon
            points={path(props.boundary)}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2.5"
          />

          {props.sensors.map((sensor) => {
            const isSelected = props.selected.includes(sensor.id);
            const isContributing = props.contributing.includes(sensor.id);
            return (
              <polygon
                key={`outline-${sensor.id}`}
                points={path(sensor.polygon)}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={isContributing ? 1.6 : 1}
                strokeDasharray={sensor.kind === 'satellite' ? '10 6' : undefined}
                opacity={isSelected ? (isContributing ? 1 : 0.35) : 0.15}
              />
            );
          })}
        </svg>

        <div className="footprint-buttons">
          {props.sensors.map((sensor) => {
            const middle = centroid(sensor.polygon);
            const isSelected = props.selected.includes(sensor.id);
            return (
              <button
                key={sensor.id}
                type="button"
                aria-pressed={isSelected}
                disabled={props.lastSelected === sensor.id}
                onClick={() => props.onToggle(sensor.id)}
                className="num"
                style={{
                  left: `${((toX(middle.x) + pad) / viewWidth) * 100}%`,
                  top: `${((toY(middle.y) + pad) / viewHeight) * 100}%`,
                }}
              >
                {sensor.id}
                <span className="visually-hidden"> footprint</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
