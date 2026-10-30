import { NumberFormat } from './values';

export type SeasonState = 'draft' | 'in_season' | 'locked' | 'archived';
export type MemberRole = 'viewer' | 'technician' | 'lead' | 'data_manager';
export type ChartType = 'bar' | 'line';

export interface CellRecord {
  input: string;
  numberFormat: NumberFormat;
  bold: boolean;
  /** Sequence number and author of the op that last set this cell's input, for conflict detection. */
  lastSeq: number;
  lastAuthorId: string;
}

export interface SheetRecord {
  id: string;
  name: string;
  position: number;
  cells: Map<string, CellRecord>;
}

export interface ChartRecord {
  id: string;
  sheetId: string;
  chartType: ChartType;
  title: string;
  /** Unqualified range, such as `A1:B4`; the sheet is `sheetId`. */
  range: string;
}

export interface WorkbookState {
  sheets: SheetRecord[];
  charts: ChartRecord[];
}

export function emptyWorkbookState(): WorkbookState {
  return { sheets: [], charts: [] };
}

export function findSheetById(state: WorkbookState, sheetId: string): SheetRecord | undefined {
  return state.sheets.find((s) => s.id === sheetId);
}

export function findSheetByName(state: WorkbookState, name: string): SheetRecord | undefined {
  const lower = name.toLowerCase();
  return state.sheets.find((s) => s.name.toLowerCase() === lower);
}

export function newCellRecord(input: string, seq: number, authorId: string): CellRecord {
  return { input, numberFormat: 'general', bold: false, lastSeq: seq, lastAuthorId: authorId };
}

export interface SnapshotCell {
  input: string;
  numberFormat: NumberFormat;
  bold: boolean;
}

export interface WorkbookSnapshot {
  sheets: { id: string; name: string; position: number; cells: Record<string, SnapshotCell> }[];
  charts: ChartRecord[];
}

export function snapshotOf(state: WorkbookState): WorkbookSnapshot {
  return {
    sheets: state.sheets.map((sheet) => {
      const cells: Record<string, SnapshotCell> = {};
      for (const [ref, cell] of sheet.cells) {
        cells[ref] = { input: cell.input, numberFormat: cell.numberFormat, bold: cell.bold };
      }
      return { id: sheet.id, name: sheet.name, position: sheet.position, cells };
    }),
    charts: state.charts.map((chart) => ({ ...chart })),
  };
}
