// Content rules for sheets and charts (Business rules · Sheets and charts), shared by the server's
// edit check and the browser's dialogs.
import { type WorkbookEngine } from "./engine.js";
import { LIMITS } from "./limits.js";
import { type Area, areaSize, parseArea, splitQualified } from "./refs.js";

const FORBIDDEN = /['![\]:*?/\\]/;
export const MAX_SHEET_NAME = 31;
const MAX_CHART_TITLE = 60;

/** A sheet name is 1–31 characters, free of ' ! [ ] : * ? / \ and unique in the workbook regardless of case. */
export function sheetNameAllowed(engine: WorkbookEngine, name: string, renamingId: string | null): boolean {
  if (name.length < 1 || name.length > MAX_SHEET_NAME || FORBIDDEN.test(name)) return false;
  const clash = engine.sheetByName(name);
  return !clash || clash.id === renamingId;
}

export function canAddSheet(engine: WorkbookEngine): boolean {
  return engine.sheets.length < LIMITS.maxSheets;
}

export function chartTitleAllowed(title: string): boolean {
  return title.length >= 1 && title.length <= MAX_CHART_TITLE;
}

/**
 * The area of a chart range on `sheetId`: the range must name that sheet (or no sheet, when `bareMeansSheet`
 * is set, as in the browser's Chart range field), cover at least 2 rows and 2 columns, and at most 10,000 cells.
 */
export function chartArea(engine: WorkbookEngine, sheetId: string, range: string, bareMeansSheet: boolean): Area | null {
  const { sheet, area: text } = splitQualified(range);
  if (sheet === null && !bareMeansSheet) return null;
  if (sheet !== null && engine.sheetByName(sheet)?.id !== sheetId) return null;
  const area = parseArea(text);
  if (!area) return null;
  const rows = area.bottom - area.top + 1;
  const cols = area.right - area.left + 1;
  return rows >= 2 && cols >= 2 && areaSize(area) <= LIMITS.maxFormulaCells ? area : null;
}
