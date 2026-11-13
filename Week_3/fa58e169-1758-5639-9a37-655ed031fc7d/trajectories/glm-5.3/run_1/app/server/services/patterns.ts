import { env, sql } from "../../common/env";
import { checkChart, type CheckChartInput, type RowResult } from "../chart/check";
import type { Colour, Repeat } from "../../common/types";
import type { StoredChart } from "../db/store";

export interface PatternRow {
  id: string;
  owner_id: string;
  name: string;
  craft: "knit" | "crochet";
  mode: "flat" | "round";
  terms: "us" | "uk" | null;
  cast_on: number;
  width: number;
  height: number;
  chart: StoredChart;
  state: "draft" | "published";
  published_version: number | null;
}

export interface PatternColours {
  letter: string;
  name: string;
  hex: string;
}

export async function loadPattern(id: string): Promise<PatternRow | null> {
  const rows = await sql<PatternRow>(`SELECT * FROM patterns WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function loadColours(patternId: string): Promise<PatternColours[]> {
  return sql<PatternColours>(
    `SELECT letter, name, hex FROM colours WHERE pattern_id = $1 ORDER BY letter`,
    [patternId],
  );
}

export async function loadRepeats(patternId: string): Promise<Repeat[]> {
  const rows = await sql<{ repeat: Repeat }>(
    `SELECT jsonb_array_elements(chart->'repeats') AS repeat FROM patterns WHERE id = $1`,
    [patternId],
  );
  return rows.map((row) => row.repeat);
}

export interface ComputedPattern {
  rows: RowResult[];
  byRow: Map<number, RowResult>;
  errors: { row: number; message: string }[];
  colourWarnings: { row: number; message: string }[];
  topMade: number;
}

/** The one place a pattern's rows and warnings are computed for every view. */
export function computePattern(pattern: PatternRow, colours: PatternColours[]): ComputedPattern {
  const chart = pattern.chart;
  const check = checkChart({
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms,
    castOn: pattern.cast_on,
    width: pattern.width,
    height: pattern.height,
    repeats: chart.repeats ?? [],
    cells: chart.cells.map((cell) => ({ row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour })),
  });
  const colourWarnings: { row: number; message: string }[] = [];
  for (const row of check.rows) {
    const worked = row.worked.filter((cell) => cell.stitch !== "ns");
    const distinct = [...new Set(worked.map((cell) => cell.colour))];
    if (distinct.length > env.limits.coloursPerRow) {
      colourWarnings.push({
        row: row.row,
        message: `Row ${row.row} uses ${distinct.length} colours, the limit is ${env.limits.coloursPerRow}.`,
      });
    }
    for (const colour of colours) {
      let best = 0;
      let start = -1;
      worked.forEach((cell, index) => {
        if (cell.colour !== colour.letter) return;
        if (start >= 0 && index > start + 1) best = Math.max(best, index - start - 1);
        start = index;
      });
      if (best > env.limits.maxFloat) {
        colourWarnings.push({
          row: row.row,
          message: `Row ${row.row}: float of ${best} stitches in colour ${colour.letter}.`,
        });
      }
    }
  }
  return {
    rows: check.rows,
    byRow: check.byRow,
    errors: check.errors,
    colourWarnings,
    topMade: check.topMade,
  };
}

export function coloursOf(colours: PatternColours[]): Colour[] {
  return colours.map((colour) => ({ letter: colour.letter, name: colour.name, hex: colour.hex }));
}

/** A fresh chart of the given size, all `ns`, colour A. */
export function blankChart(width: number, height: number, castOn: number): StoredChart {
  const cells: StoredChart["cells"] = [];
  for (let row = 1; row <= height; row++) {
    for (let col = 1; col <= width; col++) {
      cells.push({ row, col, stitch: "ns", colour: "A", rev: 1 });
    }
  }
  return { craft: "knit", mode: "flat", terms: null, castOn, width, height, repeats: [], cells };
}
