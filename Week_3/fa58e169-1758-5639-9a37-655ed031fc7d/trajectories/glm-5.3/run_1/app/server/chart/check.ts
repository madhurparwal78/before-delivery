import type { Colour, Craft, Mode, Repeat, Stitch } from "../../common/types";
import {
  CABLE_CELLS,
  CABLE_KEY,
  CABLE_TEXT,
  symbolByKey,
  symbolText,
  type StitchDef,
} from "../../common/symbols";
import { computeLine, type ComputedLine, type WorkedItem } from "./lines";

export interface WorkedCell {
  col: number;
  stitch: Stitch;
  colour: string;
  repeat: string | null;
}

export interface WorkedRow {
  row: number;
  side: "RS" | "WS" | "RND";
  worked: WorkedCell[];
  items: WorkedItem[];
  used: number;
  made: number;
  empty: boolean;
  /** error-free grouping of cables, used by the cable checks */
  cableRuns: number[];
}

export interface RowResult {
  row: number;
  side: "RS" | "WS" | "RND";
  used: number;
  made: number;
  state: "ok" | "error" | "empty";
  errors: string[];
  text: string;
  line: ComputedLine | null;
  items: WorkedItem[];
  worked: WorkedCell[];
}

export interface ChartCheck {
  rows: RowResult[];
  byRow: Map<number, RowResult>;
  errors: { row: number; message: string }[];
  topMade: number;
}

export function sideFor(mode: Mode, row: number): "RS" | "WS" | "RND" {
  if (mode === "round") return "RND";
  return row % 2 === 1 ? "RS" : "WS";
}

/** Reading order for a side: highest column first on RS and rounds. */
export function readingOrder(side: "RS" | "WS" | "RND", width: number): number[] {
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
 * Expand repeat boxes for one row: boxed columns appear `times` times in place,
 * others once, all in reading order with `ns` kept until items are built.
 */
export function workedCells(
  cellsByRow: Map<number, Map<number, { stitch: Stitch; colour: string }>>,
  row: number,
  width: number,
  side: "RS" | "WS" | "RND",
  repeats: Repeat[],
): WorkedCell[] {
  const rowCells = cellsByRow.get(row) ?? new Map<number, { stitch: Stitch; colour: string }>();
  const boxes = repeats.filter((box) => row >= box.fromRow && row <= box.toRow);
  const out: WorkedCell[] = [];
  for (const col of readingOrder(side, width)) {
    const cell = rowCells.get(col);
    const stitch = cell?.stitch ?? "ns";
    const colour = cell?.colour ?? "A";
    const box = boxes.find((entry) => col >= entry.fromCol && col <= entry.toCol);
    if (box) {
      for (let time = 1; time <= box.times; time++) out.push({ col, stitch, colour, repeat: box.id });
    } else {
      out.push({ col, stitch, colour, repeat: null });
    }
  }
  return out;
}

/** Group a worked row into items: cables in fours, one item per other cell. */
export function buildItems(
  worked: WorkedCell[],
  craft: Craft,
  terms: string | null,
  side: "RS" | "WS" | "RND",
): { items: WorkedItem[]; cableRuns: number[] } {
  const items: WorkedItem[] = [];
  const cableRuns: number[] = [];
  let index = 0;
  while (index < worked.length) {
    const cell = worked[index];
    if (cell.stitch === CABLE_KEY) {
      let end = index;
      while (end + 1 < worked.length && worked[end + 1].stitch === CABLE_KEY) end++;
      const run = worked.slice(index, end + 1);
      cableRuns.push(run.length);
      for (let start = 0; start < run.length; start += CABLE_CELLS) {
        const group = run.slice(start, start + CABLE_CELLS);
        items.push({
          key: CABLE_KEY,
          text: CABLE_TEXT,
          counted: false,
          uses: group.length,
          makes: group.length,
          colour: group[0].colour,
          cols: group.map((entry) => entry.col),
        });
      }
      index = end + 1;
      continue;
    }
    const def = symbolByKey(craft, cell.stitch);
    if (def && def.key !== "ns") {
      const text = symbolText(def, { craft, terms: terms === "us" || terms === "uk" ? terms : null }, side);
      items.push({
        key: def.key,
        text,
        counted: def.key === "k" || def.key === "p" || (craft === "crochet" && def.key !== "inc" && def.key !== "dec"),
        uses: def.uses,
        makes: def.makes,
        colour: cell.colour,
        cols: [cell.col],
      });
    }
    index++;
  }
  return { items, cableRuns };
}

export interface CheckChartInput {
  craft: Craft;
  mode: Mode;
  terms: string | null;
  castOn: number;
  width: number;
  height: number;
  repeats: Repeat[];
  cells: { row: number; col: number; stitch: Stitch; colour: string }[];
}

/**
 * The one place the row rule and every row's counts, errors and written line
 * are decided. Grid, text, compare and sheet all read this result.
 */
export function checkChart(input: CheckChartInput): ChartCheck {
  const cellsByRow = new Map<number, Map<number, { stitch: Stitch; colour: string }>>();
  for (const cell of input.cells) {
    let rowMap = cellsByRow.get(cell.row);
    if (!rowMap) {
      rowMap = new Map();
      cellsByRow.set(cell.row, rowMap);
    }
    rowMap.set(cell.col, { stitch: cell.stitch, colour: cell.colour });
  }

  const workedRows: WorkedRow[] = [];
  for (let row = 1; row <= input.height; row++) {
    const side = sideFor(input.mode, row);
    const worked = workedCells(cellsByRow, row, input.width, side, input.repeats);
    const { items, cableRuns } = buildItems(worked, input.craft, input.terms, side);
    const used = items.reduce((total, item) => total + item.uses, 0);
    const made = items.reduce((total, item) => total + item.makes, 0);
    workedRows.push({ row, side, worked, items, used, made, empty: items.length === 0, cableRuns });
  }

  const results: RowResult[] = [];
  const byRow = new Map<number, RowResult>();
  const errors: { row: number; message: string }[] = [];

  for (let index = 0; index < workedRows.length; index++) {
    const worked = workedRows[index];
    const rowErrors: string[] = [];
    if (!worked.empty) {
      const needed = neededFor(worked.row, workedRows, input.castOn);
      if (worked.used !== needed) {
        rowErrors.push(`Row ${worked.row} needs ${needed} ${needed === 1 ? "stitch" : "stitches"}, found ${worked.used}.`);
      }
      if (worked.cableRuns.some((run) => run % 4 !== 0)) {
        rowErrors.push(`Row ${worked.row}: a 2/2 cable needs 4 cells.`);
      }
      if (input.craft === "knit" && input.mode === "flat" && worked.side === "WS" && worked.items.some((item) => item.key === CABLE_KEY)) {
        rowErrors.push(`Row ${worked.row}: 2/2 LC can only be worked on a right-side row.`);
      }
    }
    const line = worked.empty ? null : computeLine(worked.row, worked.side, worked.items, input.mode);
    const state: RowResult["state"] = worked.empty ? "empty" : rowErrors.length > 0 ? "error" : "ok";
    for (const message of rowErrors) errors.push({ row: worked.row, message });
    const result: RowResult = {
      row: worked.row,
      side: worked.side,
      used: worked.used,
      made: worked.made,
      state,
      errors: rowErrors,
      text: line?.text ?? "",
      line,
      items: worked.items,
      worked: worked.worked,
    };
    results.push(result);
    byRow.set(worked.row, result);
  }

  let topMade = 0;
  for (let row = input.height; row >= 1; row--) {
    const entry = byRow.get(row);
    if (entry && !entry.items.length) continue;
    if (entry && entry.items.length > 0) {
      topMade = entry.made;
      break;
    }
  }

  return { rows: results, byRow, errors, topMade };
}

function neededFor(row: number, rows: WorkedRow[], castOn: number): number {
  if (row === 1) return castOn;
  for (let index = row - 2; index >= 0; index--) {
    const entry = rows[index];
    if (entry && !entry.empty) return entry.made;
  }
  return castOn;
}

export type { ComputedLine, WorkedItem, StitchDef };
