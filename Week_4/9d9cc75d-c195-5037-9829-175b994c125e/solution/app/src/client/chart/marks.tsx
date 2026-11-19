// The drawing of one mark, of a text spot and of the focus ring. No state: ChartView owns selection, focus and the tooltip.
import type { ChartMark, TextSpot } from '../../shared/chart/types.ts';

export function Spot({ spot, className, ...attributes }: { spot: TextSpot; className: string; 'data-tick'?: string }) {
  const { text, x, y, anchor, rotate } = spot;
  return (
    <text className={className} {...attributes} x={x} y={y} textAnchor={anchor} transform={rotate === 0 ? undefined : `rotate(${rotate} ${x} ${y})`}>
      {text}
    </text>
  );
}

/**
 * The outline is 2px wide and drawn inside the layout box, and a transparent rect fills the tap area, so the mark's
 * box is exactly the layout's whether a browser measures it with the stroke or without.
 */
const HALF_OUTLINE = 1;

function inset(box: ChartMark['box'], by: number) {
  const width = Math.max(0, box.width - 2 * by);
  const height = Math.max(0, box.height - 2 * by);
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** What the mark's `<g>` holds: its shape, the selected outline, the tap area of a point and the text inside a cell. */
export function MarkBody({ mark, fill, fontSize, selected }: { mark: ChartMark; fill: string; fontSize: number; selected: boolean }) {
  const { box } = mark;
  if (mark.shape === 'point') {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return (
      <>
        <rect className="chart-tap" {...mark.tap} />
        <circle className="chart-shape" cx={cx} cy={cy} r={Math.max(0, mark.radius - HALF_OUTLINE)} fill={fill} />
        {selected ? <circle className="chart-selected" cx={cx} cy={cy} r={Math.max(0, mark.radius - 3 * HALF_OUTLINE)} /> : null}
      </>
    );
  }
  return (
    <>
      <rect className="chart-tap" {...mark.tap} />
      <rect className="chart-shape" {...inset(box, HALF_OUTLINE)} rx={4} fill={fill} />
      {selected ? <rect className="chart-selected" {...inset(box, 3 * HALF_OUTLINE)} rx={2} /> : null}
      {mark.text === '' ? null : (
        <text className="chart-cell-text" x={box.x + box.width / 2} y={box.y + box.height / 2} fontSize={fontSize} textAnchor="middle">
          {mark.text}
        </text>
      )}
    </>
  );
}

/** A focused mark gets a sibling ring: a surface halo under an ink ring, both outside the mark's own outline. */
export function FocusRing({ mark }: { mark: ChartMark }) {
  const { box } = mark;
  if (mark.shape === 'point') {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return (
      <g className="chart-ring" aria-hidden="true">
        <circle className="chart-ring-halo" cx={cx} cy={cy} r={mark.radius + 4} />
        <circle className="chart-ring-ink" cx={cx} cy={cy} r={mark.radius + 4} />
      </g>
    );
  }
  const outset = { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8, rx: 7 };
  return (
    <g className="chart-ring" aria-hidden="true">
      <rect className="chart-ring-halo" {...outset} />
      <rect className="chart-ring-ink" {...outset} />
    </g>
  );
}
