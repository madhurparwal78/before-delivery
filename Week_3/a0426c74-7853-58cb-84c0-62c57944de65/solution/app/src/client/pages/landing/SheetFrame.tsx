import type { SVGProps } from 'react';
import type { SheetDrawing, StrokeKind } from './sheets.ts';

const FRAME_WIDTH = 220;
const FRAME_HEIGHT = 156;
/** natural size on screen, in CSS px */
const DISPLAY_WIDTH = 280;
const DISPLAY_HEIGHT = 198;

const STROKE_CLASS: Record<StrokeKind, string> = {
  plain: 'sheet-line',
  fine: 'sheet-line sheet-line--fine',
  dash: 'sheet-line sheet-line--fine sheet-line--dash',
  centre: 'sheet-line sheet-line--fine sheet-line--centre',
};

/** The little text strokes of a title block: rows of short dashes, so the frame holds no readable text. */
function titleLines(x: number, y: number, widths: readonly number[], gap: number): string {
  return widths.map((width, row) => `M${x} ${y + row * gap}h${width}`).join('');
}

function TitleBlock({ only }: { only: boolean }) {
  // The title-block-only sheet draws a larger block with a revision table, the others a compact one.
  const x = only ? 62 : 132;
  const y = only ? 90 : 120;
  const width = 212 - x;
  const height = 148 - y;
  return (
    <g>
      <path className="sheet-line" d={`M${x} ${y}h${width}v${height}h${-width}z`} />
      <path className="sheet-line sheet-line--fine" d={`M${x} ${y + height / 2}h${width}M${x + width * 0.62} ${y + height / 2}v${height / 2}`} />
      <path className="sheet-line" d={titleLines(x + 6, y + height * 0.28, [width * 0.62, width * 0.4], 5)} />
      <path className="sheet-line sheet-line--fine" d={titleLines(x + 6, y + height * 0.72, [width * 0.36], 5)} />
      <path className="sheet-line sheet-line--fine" d={titleLines(x + width * 0.62 + 6, y + height * 0.72, [width * 0.22], 5)} />
      {only ? (
        <path
          className="sheet-line sheet-line--fine"
          d={Array.from({ length: 4 }, (_, row) => `M${x} ${y - 8 - row * 8}h${width}`).join('') + `M${x + 20} ${y - 32}V${y}M${x + 60} ${y - 32}V${y}`}
        />
      ) : null}
    </g>
  );
}

/** One invented sheet drawn in code: paper edge, inner border, the drawing in white line, and a title block. */
export function SheetFrame({ drawing, ...rest }: { drawing: SheetDrawing } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
      width={DISPLAY_WIDTH}
      height={DISPLAY_HEIGHT}
      role="img"
      aria-label={drawing.title}
      {...rest}
    >
      <rect className="sheet-paper" x="1" y="1" width={FRAME_WIDTH - 2} height={FRAME_HEIGHT - 2} />
      <rect className="sheet-line sheet-line--fine" x="8" y="8" width={FRAME_WIDTH - 16} height={FRAME_HEIGHT - 16} />
      {drawing.strokes.map((stroke, index) => (
        <path key={index} className={STROKE_CLASS[stroke.kind]} d={stroke.d} />
      ))}
      <TitleBlock only={drawing.titleBlock === 'only'} />
    </svg>
  );
}
