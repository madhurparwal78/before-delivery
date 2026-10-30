// A chart drawn from its range: the first column gives categories, the first row series names, each
// other column a series. Non-numeric values plot as gaps. Values come from the furrow while it moves.
import { useId } from "react";
import { type ChartData, type ChartType } from "../../shared/engine.js";
import { generalNumber } from "../../shared/format.js";

const W = 320;
const H = 188;
const PAD = { left: 40, right: 10, top: 12, bottom: 34 };
const SERIES_TONES = ["var(--field)", "var(--field-deep)", "var(--ink-muted)", "var(--rust)"];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function ChartFigure({
  title,
  type,
  data,
  live,
  onRemove,
}: {
  title: string;
  type: ChartType;
  data: ChartData;
  live?: ChartData;
  onRemove?: () => void;
}): JSX.Element {
  const caption = useId();
  const shown = live ?? data;
  const all = data.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = niceMax(Math.max(0, ...all));
  const span = hi - lo || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number): number => PAD.top + innerH - ((v - lo) / span) * innerH;
  const n = Math.max(1, shown.categories.length);
  const band = innerW / n;
  const groups = Math.max(1, shown.series.length);
  const barW = Math.min(36, (band * 0.7) / groups);
  const ticks = [lo, lo + span / 2, hi];
  return (
    <figure className="chart" aria-labelledby={caption}>
      <figcaption id={caption}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${type === "bar" ? "Bar" : "Line"} chart of ${shown.series.map((s) => s.name).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-rule" />
            <text x={PAD.left - 6} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {generalNumber(Number(t.toPrecision(4)))}
            </text>
          </g>
        ))}
        {shown.categories.map((c, i) => (
          <text key={`${c}-${i}`} x={PAD.left + band * i + band / 2} y={H - PAD.bottom + 16} className="chart-cat" textAnchor="middle">
            {c.length > 12 ? `${c.slice(0, 11)}…` : c}
          </text>
        ))}
        {type === "bar"
          ? shown.series.map((s, si) =>
              s.values.map((v, i) =>
                v === null ? null : (
                  <rect
                    key={`${si}-${i}`}
                    className="chart-bar"
                    x={PAD.left + band * i + (band - barW * groups) / 2 + barW * si}
                    y={Math.min(y(v), y(0))}
                    width={Math.max(1, barW - 2)}
                    height={Math.abs(y(0) - y(v))}
                    fill={SERIES_TONES[si % SERIES_TONES.length]}
                  />
                ),
              ),
            )
          : shown.series.map((s, si) => {
              const points = s.values.map((v, i) => (v === null ? null : { x: PAD.left + band * i + band / 2, y: y(v) }));
              const segments: string[] = [];
              let current = "";
              for (const p of points) {
                if (!p) {
                  if (current) segments.push(current);
                  current = "";
                } else current += `${current ? " L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
              }
              if (current) segments.push(current);
              const tone = SERIES_TONES[si % SERIES_TONES.length];
              return (
                <g key={si}>
                  {segments.map((d) => (
                    <path key={d} d={d} fill="none" stroke={tone} strokeWidth="2" />
                  ))}
                  {points.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={tone} /> : null))}
                </g>
              );
            })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="chart-axis" />
      </svg>
      {shown.series.length > 1 && (
        <ul className="chart-legend">
          {shown.series.map((s, si) => (
            <li key={`${s.name}-${si}`}>
              <span className="swatch" style={{ background: SERIES_TONES[si % SERIES_TONES.length] }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {onRemove && (
        <button type="button" className="btn btn-quiet" aria-label={`Remove chart ${title}`} onClick={onRemove}>
          Remove chart
        </button>
      )}
    </figure>
  );
}
