import type { JSX } from "preact";

const WIDTH = 520;
const HEIGHT = 170;
const PAD = 18;

/** Speed per second as a line with one point per second. */
export function SpeedChart({ speeds, current }: { speeds: readonly number[]; current: number }): JSX.Element {
  const top = Math.max(1, ...speeds);
  const x = (second: number): number => (speeds.length === 1 ? WIDTH / 2 : PAD + ((second - 1) * (WIDTH - 2 * PAD)) / (speeds.length - 1));
  const y = (speed: number): number => HEIGHT - PAD - (speed / top) * (HEIGHT - 2 * PAD);
  return (
    <svg class="chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Speed over time" preserveAspectRatio="none">
      <line class="chart-base" x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} />
      <polyline class="chart-line" points={speeds.map((speed, i) => `${x(i + 1)},${y(speed)}`).join(" ")} fill="none" />
      {speeds.map((speed, i) => (
        <circle key={i} class="chart-point" cx={x(i + 1)} cy={y(speed)} r={i + 1 === current ? 7 : 4.5} data-second={i + 1} aria-current={i + 1 === current ? "true" : undefined} />
      ))}
    </svg>
  );
}
