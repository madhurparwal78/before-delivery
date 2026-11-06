/**
 * Dimension lines stand in ruled rows above and below the moped, outside its silhouette. Each line keeps its part's
 * projected horizontal extent and carries its own value, so the value can be read off the line it belongs to; extension
 * lines drop from the row to the part, or a leader runs back to it when a short bar has had to stand elsewhere. Rows are packed so that no two values ever overlap, whatever the camera does.
 */

export interface Point { x: number; y: number }
export interface DimensionInput { id: string; from: Point; to: Point; text: string; side: 'above' | 'below' }
export interface DimensionLine {
  id: string;
  /** The part's own ends, left and right on screen. */
  left: Point;
  right: Point;
  text: string;
  rowY: number;
  lineFromX: number;
  lineToX: number;
  label: { x: number; y: number; w: number; h: number };
}

const ROW_PITCH_PX = 16;
const ROWS_PER_BAND = 4;
const SHEET_MARGIN_PX = 4;
const LABEL_H = 15;
const NUMERAL_W = 7.3;
const LABEL_PAD = 8;
const CLEARANCE_PX = 6;
const BESIDE_PX = 3;

export const BANDS_PX = 2 * (ROWS_PER_BAND * ROW_PITCH_PX + SHEET_MARGIN_PX);

interface Run { from: number; to: number }
interface Row { y: number; runs: Run[] }

const isFree = (row: Row, run: Run): boolean => row.runs.every((taken) => run.to + CLEARANCE_PX <= taken.from || run.from >= taken.to + CLEARANCE_PX);

/** The first free stretch of a row wide enough for a value, as near as possible to where it wants to stand. */
function freeSpot(row: Row, wanted: number, w: number, width: number): number | null {
  const edges = [SHEET_MARGIN_PX, ...row.runs.map((taken) => taken.to + CLEARANCE_PX), ...row.runs.map((taken) => taken.from - CLEARANCE_PX - w), width - SHEET_MARGIN_PX - w];
  const usable = [wanted, ...edges].filter((x) => x >= SHEET_MARGIN_PX && x + w <= width - SHEET_MARGIN_PX && isFree(row, { from: x, to: x + w }));
  return usable.length ? usable.reduce((best, x) => (Math.abs(x - wanted) < Math.abs(best - wanted) ? x : best)) : null;
}

export function layoutDimensions(dimensions: readonly DimensionInput[], width: number, height: number): DimensionLine[] {
  const rowAt = (y: number): Row => ({ y, runs: [] });
  /** Nearest the moped first. */
  const above = Array.from({ length: ROWS_PER_BAND }, (_, i) => rowAt(SHEET_MARGIN_PX + ROW_PITCH_PX * (ROWS_PER_BAND - i - 0.5)));
  const below = Array.from({ length: ROWS_PER_BAND }, (_, i) => rowAt(height - SHEET_MARGIN_PX - ROW_PITCH_PX * (ROWS_PER_BAND - i - 0.5)));
  const longestFirst = [...dimensions].sort((a, b) => Math.abs(b.to.x - b.from.x) - Math.abs(a.to.x - a.from.x) || a.id.localeCompare(b.id));
  const lines = new Map<string, DimensionLine>();
  for (const dimension of longestFirst) {
    const [left, right] = dimension.from.x <= dimension.to.x ? [dimension.from, dimension.to] : [dimension.to, dimension.from];
    const span = right.x - left.x;
    const w = Math.ceil(dimension.text.length * NUMERAL_W + LABEL_PAD);
    const onLine = span >= w + 2 * CLEARANCE_PX;
    const beside = right.x + BESIDE_PX + w <= width - SHEET_MARGIN_PX;
    /** The stretch of a row the bar and its value take, and where the value stands in it. */
    const needed = onLine ? span : span + BESIDE_PX + w;
    const labelOffset = onLine ? (span - w) / 2 : beside ? span + BESIDE_PX : 0;
    const barOffset = !onLine && !beside ? w + BESIDE_PX : 0;
    const wanted = left.x - barOffset;
    const rows = dimension.side === 'above' ? [...above, ...below] : [...below, ...above];
    const inPlace = wanted >= SHEET_MARGIN_PX && wanted + needed <= width - SHEET_MARGIN_PX
      ? rows.find((candidate) => isFree(candidate, { from: wanted, to: wanted + needed }))
      : undefined;
    /** With no room over the part itself, the bar and value take the nearest free stretch and leaders run back to the part. */
    const moved = inPlace ? null : rows.map((candidate) => ({ candidate, spot: freeSpot(candidate, wanted, needed, width) })).find(({ spot }) => spot !== null);
    const row = inPlace ?? moved?.candidate ?? rows[0];
    const start = inPlace ? wanted : moved?.spot ?? Math.min(wanted, width - SHEET_MARGIN_PX - needed);
    row.runs.push({ from: start, to: start + needed });
    lines.set(dimension.id, {
      id: dimension.id, text: dimension.text, left, right, rowY: row.y,
      lineFromX: start + barOffset, lineToX: start + barOffset + span,
      label: { x: start + labelOffset, y: row.y - LABEL_H / 2, w, h: LABEL_H },
    });
  }
  return dimensions.flatMap((dimension) => lines.get(dimension.id) ?? []);
}
