import { ChartType } from '../../shared/workbook';

export interface ChartFigureProps {
  title: string;
  type: ChartType;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  onRemove?: () => void;
}

const WIDTH = 320;
const HEIGHT = 160;
const PADDING = 24;

export function ChartFigure({ title, type, categories, series, onRemove }: ChartFigureProps): JSX.Element {
  const numbers = series.flatMap((one) => one.values.filter((value): value is number => value !== null));
  const max = numbers.length > 0 ? Math.max(...numbers, 0) : 1;
  const min = type === 'bar' ? 0 : numbers.length > 0 ? Math.min(...numbers, 0) : 0;
  const span = max - min === 0 ? 1 : max - min;
  const plotHeight = HEIGHT - PADDING * 2;
  const plotWidth = WIDTH - PADDING * 2;
  const columnWidth = categories.length > 0 ? plotWidth / categories.length : plotWidth;

  const yOf = (value: number): number => PADDING + plotHeight - ((value - min) / span) * plotHeight;

  return (
    <figure className="chart-card" aria-label={title}>
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" className="chart-svg">
        <line x1={PADDING} y1={PADDING + plotHeight} x2={WIDTH - PADDING} y2={PADDING + plotHeight} className="chart-axis" />
        {type === 'bar'
          ? series.flatMap((one, seriesIndex) =>
              one.values.map((value, index) => {
                if (value === null) return null;
                const barWidth = columnWidth / (series.length + 1);
                const x = PADDING + index * columnWidth + barWidth * seriesIndex + barWidth / 2;
                const y = yOf(value);
                return (
                  <rect
                    key={`${one.name}-${index}`}
                    className="chart-bar"
                    x={x}
                    width={barWidth}
                    y={y}
                    height={Math.max(0, PADDING + plotHeight - y)}
                  />
                );
              }),
            )
          : series.map((one) => (
              <polyline
                key={one.name}
                className="chart-line"
                points={one.values
                  .map((value, index) =>
                    value === null
                      ? ''
                      : `${PADDING + index * columnWidth + columnWidth / 2},${yOf(value)}`,
                  )
                  .filter((point) => point !== '')
                  .join(' ')}
              />
            ))}
        {categories.map((category, index) => (
          <text
            key={category + String(index)}
            className="chart-label"
            x={PADDING + index * columnWidth + columnWidth / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
          >
            {category}
          </text>
        ))}
      </svg>
      {onRemove ? (
        <button type="button" className="ghost-button small" onClick={onRemove}>
          Remove chart {title}
        </button>
      ) : null}
    </figure>
  );
}
