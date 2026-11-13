import { checkChart, sideFor, type RowResult } from "./check";
import { scanRowText, checkFit, applyItems, type TextError } from "./grammar";
import type { Craft, Mode, Terms } from "../../common/types";

export interface ChartCellsView {
  craft: Craft;
  mode: Mode;
  terms: Terms | null;
  castOn: number;
  width: number;
  height: number;
  repeats: { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }[];
  cells: { row: number; col: number; stitch: string; colour: string }[];
  colourLetters(): string[];
}

export interface RowErr {
  row: number;
  message: string;
}

export interface CheckResult {
  rows: RowResult[];
  byRow: Map<number, RowResult>;
  errors: RowErr[];
  topMade: number;
}

export function computeRows(chart: ChartCellsView): CheckResult {
  return checkChart({
    craft: chart.craft,
    mode: chart.mode,
    terms: chart.terms,
    castOn: chart.castOn,
    width: chart.width,
    height: chart.height,
    repeats: chart.repeats,
    cells: chart.cells,
  });
}

/** Every cell of a chart as a list of { row, col, stitch, colour } */
export function fullCells(
  width: number,
  height: number,
  overrides: { row: number; col: number; stitch: string; colour: string }[],
): { row: number; col: number; stitch: string; colour: string }[] {
  const list: { row: number; col: number; stitch: string; colour: string }[] = [];
  const map = new Map<string, { stitch: string; colour: string }>();
  for (const cell of overrides) map.set(`${cell.row}:${cell.col}`, { stitch: cell.stitch, colour: cell.colour });
  for (let row = 1; row <= height; row++) {
    for (let col = 1; col <= width; col++) {
      const found = map.get(`${row}:${col}`);
      list.push({ row, col, stitch: found?.stitch ?? "ns", colour: found?.colour ?? "A" });
    }
  }
  return list;
}

/** Reading order for a row of the chart. */
export function rowOrder(mode: Mode, row: number, width: number): number[] {
  const side = sideFor(mode, row);
  if (side === "WS") {
    const order: number[] = [];
    for (let col = 1; col <= width; col++) order.push(col);
    return order;
  }
  const order: number[] = [];
  for (let col = width; col >= 1; col--) order.push(col);
  return order;
}

/**
 * The one place typed text becomes cells. Returns the cells to write, or the
 * exact error. The row's needed stitches come from the nearest non-empty row
 * below, or the cast-on.
 */
export function applyTextToRow(
  chart: ChartCellsView,
  row: number,
  text: string,
): { ok: true; cells: { row: number; col: number; stitch: string; colour: string }[]; repeats: number } | { ok: false; error: TextError } {
  const check = computeRows(chart);
  const rowResult = check.byRow.get(row);
  if (!rowResult) {
    return { ok: false, error: { position: null, message: `Row ${row} is not on the chart.` } };
  }
  const box = chart.repeats.find((entry) => row >= entry.fromRow && row <= entry.toRow);
  if (box) {
    return {
      ok: false,
      error: { position: null, message: `Row ${row}: expand repeat ${box.id} before editing this row as text.` },
    };
  }
  const side = rowResult.side;
  const scan = scanRowText(text, row, side, chart.craft, chart.terms, chart.colourLetters());
  if (!scan.ok) return { ok: false, error: scan.error };
  const needed = rowNeeded(check, row, chart.castOn);
  const fit = checkFit(scan.parsed, row, chart.width, needed);
  if (!fit.ok) return { ok: false, error: fit.error };

  // place items into cells in reading order
  const order = rowOrder(chart.mode, row, chart.width);
  const byCol = new Map<number, { stitch: string; colour: string }>();
  for (const cell of chart.cells) if (cell.row === row) byCol.set(cell.col, { stitch: cell.stitch, colour: cell.colour });
  const startIdx = order.findIndex((col) => (byCol.get(col)?.stitch ?? "ns") !== "ns");
  const firstCol = startIdx === -1 ? order[0]! : order[startIdx]!;
  const flat = applyItems(fit.worked.items);
  const totalCells = flat.reduce((total, item) => total + item.cells, 0);
  let start = order.indexOf(firstCol);
  if (start + totalCells > order.length) start = order.length - totalCells;
  const out: { row: number; col: number; stitch: string; colour: string }[] = [];
  let cursor = start;
  for (const item of flat) {
    for (let cell = 0; cell < item.cells; cell++) {
      const col = order[cursor]!;
      const existing = byCol.get(col);
      const stitch = side === "WS" ? wsSymbol(item.stitch) : item.stitch;
      out.push({ row, col, stitch, colour: item.colour ?? existing?.colour ?? "A" });
      cursor++;
    }
  }
  const touched = new Set(out.map((cell) => cell.col));
  for (const col of order) {
    if (!touched.has(col)) out.push({ row, col, stitch: "ns", colour: byCol.get(col)?.colour ?? "A" });
  }
  return { ok: true, cells: out, repeats: fit.worked.repeats };
}

/** Wrong-side texts become their chart symbols: k and p swap. */
function wsSymbol(key: string): string {
  if (key === "k") return "p";
  if (key === "p") return "k";
  return key;
}

export function rowNeeded(check: CheckResult, row: number, castOn: number): number {
  for (let below = row - 1; below >= 1; below--) {
    const entry = check.byRow.get(below);
    if (entry && entry.items.length > 0) return entry.made;
  }
  return castOn;
}
