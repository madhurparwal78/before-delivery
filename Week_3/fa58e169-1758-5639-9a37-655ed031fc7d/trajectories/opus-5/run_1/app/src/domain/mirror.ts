import { makeGrid } from './chart';
import type { Chart } from './types';

const MIRROR_PARTNERS: Record<string, string> = {
  k2tog: 'ssk',
  ssk: 'k2tog',
  m1l: 'm1r',
  m1r: 'm1l',
};

function mirrorPartner(stitch: string): string {
  return MIRROR_PARTNERS[stitch] ?? stitch;
}

export interface MirroredCell {
  row: number;
  col: number;
  stitch: string;
  colour: string;
}

/** Each selected row reversed inside the selection, cells carrying their colours. */
export function mirrorSelection(
  chart: Chart,
  fromRow: number,
  toRow: number,
  fromCol: number,
  toCol: number,
): MirroredCell[] {
  const grid = makeGrid(chart);
  const mirrored: MirroredCell[] = [];
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) {
      const source = grid(row, fromCol + toCol - col);
      mirrored.push({ row, col, stitch: mirrorPartner(source.stitch), colour: source.colour });
    }
  }
  return mirrored;
}

export function selectionTouchesRepeat(
  chart: Chart,
  fromRow: number,
  toRow: number,
  fromCol: number,
  toCol: number,
): boolean {
  return chart.repeats.some(
    (box) =>
      box.fromRow <= toRow && box.toRow >= fromRow && box.fromCol <= toCol && box.toCol >= fromCol,
  );
}
