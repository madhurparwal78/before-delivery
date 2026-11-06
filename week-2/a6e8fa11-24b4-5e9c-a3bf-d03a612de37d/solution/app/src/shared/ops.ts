// Ops as devices send them in sync batches (API · Sync), and how each one changes the engine.
import { type ChartType, type WorkbookEngine } from "./engine.js";
import { type Area, parseArea, splitQualified } from "./refs.js";
import { type CellFormat } from "./values.js";

export type Op =
  | { opId: string; type: "setCell"; sheetId: string; cell: string; input: string }
  | { opId: string; type: "setFormat"; sheetId: string; range: string; format: Partial<CellFormat> }
  | { opId: string; type: "addSheet"; sheetId: string; name: string }
  | { opId: string; type: "renameSheet"; sheetId: string; name: string }
  | { opId: string; type: "addChart"; chartId: string; sheetId: string; chartType: ChartType; title: string; range: string }
  | { opId: string; type: "removeChart"; chartId: string };

/** Applies an op that already passed every check. */
export function applyOp(engine: WorkbookEngine, op: Op): void {
  switch (op.type) {
    case "setCell":
      engine.setCell(op.sheetId, op.cell, op.input);
      return;
    case "setFormat":
      engine.setFormat(op.sheetId, parseArea(op.range) as Area, op.format);
      return;
    case "addSheet":
      engine.addSheet(op.sheetId, op.name);
      return;
    case "renameSheet":
      engine.renameSheet(op.sheetId, op.name);
      return;
    case "addChart":
      engine.addChart({ id: op.chartId, sheetId: op.sheetId, type: op.chartType, title: op.title, area: parseArea(splitQualified(op.range).area) as Area });
      return;
    case "removeChart":
      engine.removeChart(op.chartId);
      return;
  }
}
