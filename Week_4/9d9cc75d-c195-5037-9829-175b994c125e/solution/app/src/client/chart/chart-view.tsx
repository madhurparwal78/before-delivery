import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { layoutChart } from '../../shared/chart/layout.ts';
import type { ChartLayout, ChartMark } from '../../shared/chart/types.ts';
import type { QueryResult } from '../../shared/model.ts';
import { glide, prefersReducedMotion } from './glide.ts';
import { FocusRing, MarkBody, Spot } from './marks.tsx';
import { fillOf, PatternDefs, scaleId, type Swatch } from './patterns.tsx';
import type { ChartViewProps, MarkInfo } from './props.ts';
import './chart.css';

const TOOLTIP_HALF_WIDTH = 144;
const SWATCH = 20;

function infoOf(mark: ChartMark, dimensions: readonly string[]): MarkInfo {
  return { id: mark.id, index: mark.index, dims: mark.dims, dimensions: [...dimensions], values: mark.values, tooltip: mark.tooltip };
}

function useWidth(target: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return width;
}

function Legend({ layout, scope }: { layout: ChartLayout; scope: string }) {
  if (layout.legend.length === 0) return null;
  return (
    <ul className="chart-legend" role="list" aria-label="Legend">
      {layout.legend.map((entry) => (
        <li key={entry.text}>
          <svg width={SWATCH} height={SWATCH} viewBox={`0 0 ${SWATCH} ${SWATCH}`} aria-hidden="true" focusable="false">
            <rect className="chart-shape" x="1" y="1" width={SWATCH - 2} height={SWATCH - 2} rx="4" fill={entry.scale ? `url(#${scaleId(scope)})` : fillOf(scope, entry)} />
          </svg>
          {entry.text}
        </li>
      ))}
    </ul>
  );
}

export function ChartView({ sheetName, sheet, result, touch, compact = false, height, dimmed = null, onSelect, onTap }: ChartViewProps) {
  const scope = useId().replace(/[^A-Za-z0-9]/g, '');
  const scroller = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, SVGGElement>());
  const previous = useRef<{ result: QueryResult; boxes: Map<string, ChartMark['tap']> } | null>(null);
  const width = useWidth(scroller);
  const [selected, setSelected] = useState<string | null>(null);
  const [stop, setStop] = useState(0);
  const [tipped, setTipped] = useState<string | null>(null);
  const [ringed, setRinged] = useState<string | null>(null);

  const layout = useMemo(
    () => (width > 0 ? layoutChart(sheet, result, { width, height: height ?? null }, { touch, compact }) : null),
    [sheet, result, width, height, touch, compact],
  );

  useLayoutEffect(() => {
    if (!layout) return;
    const boxes = new Map(layout.marks.map((mark) => [mark.id, mark.tap]));
    const last = previous.current;
    if (last && last.result !== result && !prefersReducedMotion()) {
      for (const mark of layout.marks) {
        const from = last.boxes.get(mark.id);
        const element = elements.current.get(mark.id);
        if (from && element) glide(element, from, mark.tap);
      }
    }
    previous.current = { result, boxes };
    setSelected((now) => (now !== null && !boxes.has(now) ? null : now));
  }, [layout, result]);

  if (!layout || layout.kind === 'none') return <div className="chart"><div className="chart-scroll" ref={scroller} /></div>;

  const marks = layout.marks;
  const swatches: Swatch[] = [...marks, ...layout.legend];
  const rovingStop = Math.min(stop, marks.length - 1);
  const tipMark = marks.find((mark) => mark.id === tipped);
  const ringMark = marks.find((mark) => mark.id === ringed);

  const select = (mark: ChartMark) => {
    setSelected(mark.id);
    onSelect?.(infoOf(mark, layout.dimensions));
  };
  const clear = () => {
    setTipped(null);
    if (selected !== null) {
      setSelected(null);
      onSelect?.(null);
    }
  };
  const moveFocus = (to: number) => {
    const target = marks[Math.max(0, Math.min(marks.length - 1, to))];
    if (target) elements.current.get(target.id)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<SVGGElement>, mark: ChartMark) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(mark.index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(mark.index - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        select(mark);
        break;
      case 'Escape':
        clear();
        break;
    }
  };
  const onClick = (mark: ChartMark) => {
    elements.current.get(mark.id)?.focus();
    select(mark);
    if (touch) {
      setTipped(null);
      onTap?.(infoOf(mark, layout.dimensions));
    }
  };
  const onPointerEnter = (event: PointerEvent<SVGGElement>, mark: ChartMark) => {
    if (event.pointerType === 'mouse') setTipped(mark.id);
  };

  const stageWidth = layout.size.width;
  const tipX = tipMark ? tipMark.box.x + tipMark.box.width / 2 - (scroller.current?.scrollLeft ?? 0) : 0;
  const tipAbove = tipMark ? tipMark.box.y >= 56 : true;
  const tipLeft = Math.min(Math.max(tipX, TOOLTIP_HALF_WIDTH), Math.max(TOOLTIP_HALF_WIDTH, width - TOOLTIP_HALF_WIDTH));

  return (
    <div className="chart" data-compact={compact ? 'true' : undefined}>
      <div className="chart-scroll" ref={scroller}>
        <svg
          className="chart-svg"
          width={stageWidth}
          height={layout.size.height}
          viewBox={`0 0 ${stageWidth} ${layout.size.height}`}
          role="group"
          aria-label={sheetName}
        >
          <PatternDefs scope={scope} swatches={swatches} scale={layout.legend.find((entry) => entry.scale)?.scale ?? null} />
          <g className="chart-axes" fontSize={layout.fontSize.label}>
            {layout.ticks.map((tick, i) => (
              <line key={i} className="chart-grid" {...tick.line} />
            ))}
            <rect className="chart-plot" data-plot="" {...layout.plot} onClick={clear} />
            {layout.baseline ? <line className="chart-baseline" {...layout.baseline} /> : null}
            {layout.ticks.map((tick, i) => (
              <Spot key={i} spot={tick} className="chart-tick" data-tick="" />
            ))}
            {layout.categories.map((spot, i) => (
              <Spot key={i} spot={spot} className="chart-category" />
            ))}
            {layout.titles.map((spot, i) => (
              <Spot key={i} spot={spot} className="chart-title" />
            ))}
          </g>
          {layout.series.map((series, i) =>
            series.runs.map((run, j) =>
              run.length > 1 ? (
                <g key={`${i}-${j}`} className="chart-series" aria-hidden="true">
                  <polyline className="chart-line-halo" points={run.map((p) => `${p.x},${p.y}`).join(' ')} />
                  <polyline className="chart-line" stroke={`rgb(${series.color})`} points={run.map((p) => `${p.x},${p.y}`).join(' ')} />
                </g>
              ) : null,
            ),
          )}
          {ringMark ? <FocusRing mark={ringMark} /> : null}
          {marks.map((mark) => (
            <g
              key={mark.id}
              ref={(element) => {
                if (element) elements.current.set(mark.id, element);
                return () => {
                  elements.current.delete(mark.id);
                };
              }}
              className="chart-mark"
              role="button"
              tabIndex={mark.index === rovingStop ? 0 : -1}
              data-mark={mark.id}
              data-dims={mark.id}
              data-measure={mark.measure}
              data-value={mark.value}
              data-color={mark.color}
              data-pattern={mark.pattern}
              data-dim={dimmed?.has(mark.id) ? 'true' : undefined}
              aria-pressed={selected === mark.id}
              aria-label={mark.ariaLabel}
              aria-describedby={tipMark?.id === mark.id ? `${scope}-tip` : undefined}
              onClick={() => onClick(mark)}
              onKeyDown={(event) => onKeyDown(event, mark)}
              onFocus={(event) => {
                setStop(mark.index);
                setTipped(mark.id);
                setRinged(event.currentTarget.matches(':focus-visible') ? mark.id : null);
              }}
              onBlur={() => {
                setTipped((now) => (now === mark.id ? null : now));
                setRinged(null);
              }}
              onPointerEnter={(event) => onPointerEnter(event, mark)}
              onPointerLeave={() => setTipped((now) => (now === mark.id ? null : now))}
            >
              <MarkBody mark={mark} fill={fillOf(scope, mark)} fontSize={layout.fontSize.mark} selected={selected === mark.id} />
            </g>
          ))}
          <g className="chart-notes" fontSize={layout.fontSize.label} aria-hidden="true">
            {marks.map((mark) =>
              mark.label ? <Spot key={`l${mark.id}`} spot={mark.label} className="chart-label" /> : null,
            )}
            {marks.map((mark) =>
              mark.value === '' && mark.measure !== '' && mark.shape !== 'cell' && mark.shape !== 'text' ? (
                <text key={`n${mark.id}`} className="chart-label" x={mark.box.x + mark.box.width + 6} y={mark.box.y + mark.box.height / 2}>
                  (null)
                </text>
              ) : null,
            )}
            {layout.references.map((line) => (
              <g key={`${line.type}${line.value}`}>
                <line className="chart-ref" data-ref={line.type} {...line.segment} />
                <Spot spot={line.label} className="chart-ref-label" />
              </g>
            ))}
            {layout.trend ? <line className="chart-trend" {...layout.trend.segment} /> : null}
          </g>
        </svg>
      </div>
      {tipMark ? (
        <div
          id={`${scope}-tip`}
          role="tooltip"
          className="chart-tooltip"
          data-above={tipAbove ? 'true' : 'false'}
          style={{ left: tipLeft, top: tipAbove ? tipMark.box.y - 8 : tipMark.box.y + tipMark.box.height + 8 }}
        >
          {tipMark.tooltip}
        </div>
      ) : null}
      <Legend layout={layout} scope={scope} />
    </div>
  );
}
