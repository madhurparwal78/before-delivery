// The board drawn to scale: rack strips, the intake strip and the shared hatch and grain.
// In every drawing the root carries data-scale (px per mm) and each item sits at mm × scale.
import { forwardRef, type PointerEventHandler, type ReactNode, type KeyboardEventHandler } from "react";
import type { DefectZone } from "../shared/domain";

/** One set of pattern definitions for the whole page, referenced by every drawing. */
export function DrawingDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-ground" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>
    </svg>
  );
}

const LABEL_ROW = 16;

/** Defect zones, hatched, with their kind written underneath where it fits. */
export function DefectZones({ defects, scale, top, height, maxX }: { defects: DefectZone[]; scale: number; top: number; height: number; maxX: number }) {
  let lastEnd = -Infinity;
  const labels: ReactNode[] = [];
  const zones = defects.map((d, i) => {
    const x = d.start_mm * scale;
    const width = Math.max((d.end_mm - d.start_mm) * scale, 0);
    const text = d.kind;
    const estimate = text.length * 7.2;
    const lx = Math.min(x, maxX - estimate);
    if (lx >= lastEnd + 10) {
      labels.push(<text key={`l${i}`} x={lx} y={top + height + 12} className="defect-label">{text}</text>);
      lastEnd = lx + estimate;
    }
    return (
      <rect key={i} data-defect={d.kind} x={x} y={top} width={width} height={height} className="defect">
        <title>{`${d.kind} ${d.start_mm}–${d.end_mm} mm`}</title>
      </rect>
    );
  });
  return <g>{zones}{labels}</g>;
}

/** Faint printed grain behind everything, so the strip reads as timber. */
function Grain({ width, top, height }: { width: number; top: number; height: number }) {
  const lines = [0.28, 0.55, 0.78].map((f, i) => {
    const y = top + height * f;
    const w = Math.max(width, 0);
    return <path key={i} className="grain" d={`M0 ${y} C ${w * 0.3} ${y - 2}, ${w * 0.6} ${y + 2}, ${w} ${y}`} />;
  });
  return <g aria-hidden="true">{lines}</g>;
}

interface StripProps {
  label: string;
  /** Drawn width of the SVG in px. */
  width: number;
  scale: number;
  lengthMm: number | null;
  defects: DefectZone[];
  boardHeight: number;
  tally?: number;
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
  onPointerDown?: PointerEventHandler<SVGSVGElement>;
  onPointerMove?: PointerEventHandler<SVGSVGElement>;
  onPointerUp?: PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: PointerEventHandler<SVGSVGElement>;
  onKeyDown?: KeyboardEventHandler<SVGSVGElement>;
}

export const Strip = forwardRef<SVGSVGElement, StripProps>(function Strip(
  { label, width, scale, lengthMm, defects, boardHeight, tally, children, className, ...events }, ref,
) {
  const height = boardHeight + LABEL_ROW;
  const boardWidth = lengthMm === null ? 0 : lengthMm * scale;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={label}
      data-scale={scale}
      width={Math.max(width, 0)}
      height={height}
      viewBox={`0 0 ${Math.max(width, 0)} ${height}`}
      className={className}
      {...events}
    >
      {lengthMm !== null && (
        <>
          <rect x={0} y={0} width={boardWidth} height={boardHeight} className="timber" />
          <Grain width={boardWidth} top={0} height={boardHeight} />
          <DefectZones defects={defects} scale={scale} top={0} height={boardHeight} maxX={width} />
          {tally !== undefined && (
            <g data-tally={tally} className="tally">
              {Array.from({ length: tally }, (_, i) => (
                <line key={i} x1={6 + i * 6} y1={boardHeight - 4} x2={10 + i * 6} y2={4} />
              ))}
            </g>
          )}
        </>
      )}
      {children}
    </svg>
  );
});

