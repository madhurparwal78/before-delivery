import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { SheetShape } from '../../../shared/model.ts';
import { ChartView, DataTable } from '../../chart/index.ts';
import type { MarkInfo } from '../../chart/index.ts';
import { Button } from '../../ui/button.tsx';
import { Status } from '../../ui/live.tsx';
import { highlightedMarks } from './selection.ts';
import type { Highlight } from './selection.ts';
import type { SheetView } from './use-board.ts';

/** Room kept under the chart for a legend, which the chart draws below its plot. */
const LEGEND_ROOM = 48;

/** The height of an element that does not depend on its content, kept current by a ResizeObserver. */
function useHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const target = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    setHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [target, height];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  id: string;
  name: string;
  shape: SheetShape;
  view: SheetView;
  highlights: readonly Highlight[];
  /** the object's box on the stage */
  box: Box;
  /** a phone column asks the chart for this height and lets the region grow around whatever the chart needs */
  fixedHeight?: number;
  style: CSSProperties;
  phone: boolean;
  onSelect: (sheet: string, mark: MarkInfo | null) => void;
  onTap: (mark: MarkInfo) => void;
}

/** `region "{sheet name}"`: the chart, its twin behind `button "Table for {sheet name}"`, and the busy chip. */
export function SheetRegion({ id, name, shape, view, highlights, box, fixedHeight, style, phone, onSelect, onTap }: Props) {
  const [expanded, setExpanded] = useState(false);
  const twinId = useId();
  const [chartBox, chartHeight] = useHeight<HTMLDivElement>();
  const lit = useMemo(
    () => (view.result ? highlightedMarks(shape, view.result, highlights) : null),
    [shape, view.result, highlights],
  );
  const height = fixedHeight ?? Math.max(0, chartHeight - (shape.color ? LEGEND_ROOM : 0));

  return (
    <section
      role="region"
      aria-label={name}
      aria-busy={view.busy}
      className="board-sheet"
      data-f6=""
      data-x={box.x}
      data-y={box.y}
      data-w={box.w}
      data-h={box.h}
      style={style}
    >
      <div className="board-sheet-head">
        <h2 className="board-sheet-title">{name}</h2>
        <div className="board-sheet-busy">{view.busy ? <span className="chip board-updating">Updating...</span> : null}</div>
        <Button compact aria-expanded={expanded} aria-controls={twinId} onClick={() => setExpanded(!expanded)}>
          Table for {name}
        </Button>
      </div>
      <Status name="View notice" text={view.notice} />
      <div className="board-chart" ref={chartBox} style={{ minHeight: fixedHeight }}>
        {view.result && view.result.chart !== 'none' && height > 0 ? (
          <ChartView
            sheetName={name}
            sheet={shape}
            result={view.result}
            touch={phone}
            compact
            height={height}
            dimmed={lit?.dimmed ?? null}
            onSelect={(mark) => onSelect(id, mark)}
            onTap={onTap}
          />
        ) : null}
      </div>
      <div id={twinId} className="board-twin" data-open={expanded}>
        {view.result ? <DataTable sheetName={name} result={view.result} highlighted={lit?.matching ?? null} /> : null}
      </div>
    </section>
  );
}
