// The board elevation: a shop drawing of one board at true scale with pieces, defects,
// kerf lines and the offcut, plus the slate ruler beneath it.
import { forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { KERF_ALLOWANCE_MM, KERF_MM, lengthText, overDefect, type DefectZone, type Piece, type Unit } from "../shared/domain";
import { DefectZones } from "./drawing";

export interface DrawnPiece extends Piece {
  id: number;
}

export interface KerfDrawing {
  cuts: number[];
  take: number;
  offcut: number | null;
}

interface Props {
  tag: string;
  lengthMm: number;
  defects: DefectZone[];
  width: number;
  boardHeight: number;
  pieces: DrawnPiece[];
  selectedId: number | null;
  kerf: KerfDrawing | null;
  unit: Unit;
  onPiecePointerDown: (id: number, e: ReactPointerEvent<SVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
}

const LABEL_ROW = 16;

export const Elevation = forwardRef<SVGSVGElement, Props>(function Elevation(
  { tag, lengthMm, defects, width, boardHeight, pieces, selectedId, kerf, unit, onPiecePointerDown, onPointerMove, onPointerUp }, ref,
) {
  const scale = width / lengthMm;
  const h = boardHeight;
  const kerfWidth = Math.max(2, KERF_MM * scale);
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={`Board elevation ${tag}`}
      data-scale={scale}
      width={width}
      height={h + LABEL_ROW}
      viewBox={`0 0 ${width} ${h + LABEL_ROW}`}
      className="elevation"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <rect x={0} y={0} width={width} height={h} className="timber" />
      {[0.22, 0.47, 0.71, 0.86].map((f) => (
        <path key={f} className="grain" d={`M0 ${h * f} C ${width * 0.3} ${h * f - 3}, ${width * 0.65} ${h * f + 3}, ${width} ${h * f}`} />
      ))}
      {kerf && kerf.offcut !== null && (
        <g className="offcut-group">
          <rect data-offcut="" x={(kerf.take + KERF_ALLOWANCE_MM) * scale} y={0} width={kerf.offcut * scale} height={h} className="offcut" />
          <text x={(kerf.take + KERF_ALLOWANCE_MM + kerf.offcut / 2) * scale} y={h / 2 + 5} className="offcut-label" textAnchor="middle">
            {lengthText(kerf.offcut, unit)}
          </text>
        </g>
      )}
      <DefectZones defects={defects} scale={scale} top={0} height={h} maxX={width} />
      {pieces.map((p, i) => {
        const over = overDefect(p, defects);
        return (
          <g key={p.id} className={`piece${over ? " over" : ""}${p.id === selectedId ? " selected" : ""}`}>
            <rect
              data-piece={i}
              x={p.start_mm * scale}
              y={8}
              width={p.length_mm * scale}
              height={h - 16}
              onPointerDown={(e) => onPiecePointerDown(p.id, e)}
            />
            <text x={p.start_mm * scale + 6} y={h / 2 + 5} className="piece-label" pointerEvents="none">{p.label}</text>
          </g>
        );
      })}
      {kerf?.cuts.map((c) => (
        <rect key={c} data-kerf={c} x={c * scale - kerfWidth / 2} y={0} width={kerfWidth} height={h} className="kerf" />
      ))}
    </svg>
  );
});

/** Slate ruler ticks every 100 mm, labelled every 500 mm (or 1000 mm when narrow). */
export function Ruler({ lengthMm, width }: { lengthMm: number; width: number }) {
  const scale = width / lengthMm;
  const every = scale * 500 < 60 ? 1000 : 500;
  const ticks = [];
  for (let mm = 0; mm <= lengthMm; mm += 100) {
    const major = mm % every === 0;
    ticks.push(<line key={mm} x1={mm * scale} x2={mm * scale} y1={0} y2={major ? 10 : 5} />);
    if (major && mm > 0 && mm * scale < width - 70) ticks.push(<text key={`t${mm}`} x={mm * scale} y={22} textAnchor="middle">{mm}</text>);
  }
  return (
    <svg className="ruler" width={width} height={26} viewBox={`0 0 ${width} 26`} aria-hidden="true" focusable="false">
      <line x1={0} x2={width} y1={0.5} y2={0.5} />
      {ticks}
      <text x={width - 2} y={22} textAnchor="end">{lengthMm} mm</text>
    </svg>
  );
}
