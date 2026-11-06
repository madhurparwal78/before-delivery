import { LIMITS, MAX_CHART_TITLE_CHARS, MAX_SHEET_NAME_CHARS } from './limits';
import { parseCellRef, parseRangeRef, rangeCellCount, splitQualified } from './refs';
import { NumberFormat, isNumberFormat, parseInput } from './values';
import {
  CellRecord,
  ChartType,
  WorkbookSnapshot,
  WorkbookState,
  findSheetById,
  findSheetByName,
} from './workbook';
import { rewriteSheetNameInFormula } from './formula/parse';

export interface SetCellOp {
  opId: string;
  type: 'setCell';
  sheetId: string;
  cell: string;
  input: string;
}

export interface SetFormatOp {
  opId: string;
  type: 'setFormat';
  sheetId: string;
  range: string;
  format: { numberFormat?: NumberFormat; bold?: boolean };
}

export interface AddSheetOp {
  opId: string;
  type: 'addSheet';
  sheetId: string;
  name: string;
}

export interface RenameSheetOp {
  opId: string;
  type: 'renameSheet';
  sheetId: string;
  name: string;
}

export interface AddChartOp {
  opId: string;
  type: 'addChart';
  chartId: string;
  sheetId: string;
  chartType: ChartType;
  title: string;
  range: string;
}

export interface RemoveChartOp {
  opId: string;
  type: 'removeChart';
  chartId: string;
}

export type ClientOp = SetCellOp | SetFormatOp | AddSheetOp | RenameSheetOp | AddChartOp | RemoveChartOp;
export type ClientOpType = ClientOp['type'];

export interface RestoreOp {
  type: 'restore';
  snapshot: WorkbookSnapshot;
}

export type StoredOp = ClientOp | RestoreOp;

export const CLIENT_OP_TYPES: ClientOpType[] = [
  'setCell',
  'setFormat',
  'addSheet',
  'renameSheet',
  'addChart',
  'removeChart',
];

const OP_FIELDS: Record<ClientOpType, string[]> = {
  setCell: ['sheetId', 'cell', 'input'],
  setFormat: ['sheetId', 'range', 'format'],
  addSheet: ['sheetId', 'name'],
  renameSheet: ['sheetId', 'name'],
  addChart: ['chartId', 'sheetId', 'chartType', 'title', 'range'],
  removeChart: ['chartId'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_SHEET_CHARS = ["'", '!', '[', ']', ':', '*', '?', '/', '\\'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape validation of a single op (edit check 1). Returns a typed op or null. */
export function parseClientOp(raw: unknown): ClientOp | null {
  if (!isPlainObject(raw)) return null;
  const type = raw.type;
  if (typeof type !== 'string' || !(CLIENT_OP_TYPES as string[]).includes(type)) return null;
  const opType = type as ClientOpType;
  const allowed = new Set(['opId', 'type', ...OP_FIELDS[opType]]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return null;
  }
  for (const field of OP_FIELDS[opType]) {
    if (!(field in raw)) return null;
  }
  const opId = raw.opId;
  if (typeof opId !== 'string' || opId.length < 1 || opId.length > 64) return null;
  switch (opType) {
    case 'setCell': {
      if (typeof raw.sheetId !== 'string' || typeof raw.cell !== 'string' || typeof raw.input !== 'string') return null;
      if (!parseCellRef(raw.cell)) return null;
      if (raw.input.length > LIMITS.maxInputChars) return null;
      return { opId, type: 'setCell', sheetId: raw.sheetId, cell: raw.cell.toUpperCase(), input: raw.input };
    }
    case 'setFormat': {
      if (typeof raw.sheetId !== 'string' || typeof raw.range !== 'string' || !isPlainObject(raw.format)) return null;
      if (!parseRangeRef(raw.range)) return null;
      const keys = Object.keys(raw.format);
      if (keys.length === 0) return null;
      for (const key of keys) {
        if (key !== 'numberFormat' && key !== 'bold') return null;
      }
      const format: { numberFormat?: NumberFormat; bold?: boolean } = {};
      if ('numberFormat' in raw.format) {
        if (!isNumberFormat(raw.format.numberFormat)) return null;
        format.numberFormat = raw.format.numberFormat;
      }
      if ('bold' in raw.format) {
        if (typeof raw.format.bold !== 'boolean') return null;
        format.bold = raw.format.bold;
      }
      return { opId, type: 'setFormat', sheetId: raw.sheetId, range: raw.range.toUpperCase(), format };
    }
    case 'addSheet': {
      if (typeof raw.sheetId !== 'string' || typeof raw.name !== 'string') return null;
      if (!UUID_RE.test(raw.sheetId)) return null;
      return { opId, type: 'addSheet', sheetId: raw.sheetId, name: raw.name };
    }
    case 'renameSheet': {
      if (typeof raw.sheetId !== 'string' || typeof raw.name !== 'string') return null;
      return { opId, type: 'renameSheet', sheetId: raw.sheetId, name: raw.name };
    }
    case 'addChart': {
      if (
        typeof raw.chartId !== 'string' ||
        typeof raw.sheetId !== 'string' ||
        typeof raw.title !== 'string' ||
        typeof raw.range !== 'string' ||
        (raw.chartType !== 'bar' && raw.chartType !== 'line')
      ) {
        return null;
      }
      if (!UUID_RE.test(raw.chartId)) return null;
      return {
        opId,
        type: 'addChart',
        chartId: raw.chartId,
        sheetId: raw.sheetId,
        chartType: raw.chartType,
        title: raw.title,
        range: raw.range,
      };
    }
    case 'removeChart': {
      if (typeof raw.chartId !== 'string') return null;
      return { opId, type: 'removeChart', chartId: raw.chartId };
    }
  }
}

export function sheetNameIsValid(name: string, state: WorkbookState, exceptSheetId: string | null): boolean {
  if (name.length < 1 || name.length > MAX_SHEET_NAME_CHARS) return false;
  for (const ch of FORBIDDEN_SHEET_CHARS) {
    if (name.includes(ch)) return false;
  }
  const existing = findSheetByName(state, name);
  return !existing || existing.id === exceptSheetId;
}

export interface ChartRangeParts {
  sheetName: string;
  range: string;
}

export function chartRangeIsValid(op: AddChartOp, state: WorkbookState): boolean {
  if (op.title.length < 1 || op.title.length > MAX_CHART_TITLE_CHARS) return false;
  const split = splitQualified(op.range);
  if (!split || split.sheetName === null) return false;
  const sheet = findSheetByName(state, split.sheetName);
  if (!sheet || sheet.id !== op.sheetId) return false;
  const parsed = parseRangeRef(split.rest);
  if (!parsed) return false;
  if (parsed.endRow - parsed.startRow + 1 < 2) return false;
  if (parsed.endCol - parsed.startCol + 1 < 2) return false;
  if (rangeCellCount(parsed) > LIMITS.maxFormulaCells) return false;
  return true;
}

/** Content rules for sheet and chart ops (edit check 5). */
export function contentRulesPass(op: ClientOp, state: WorkbookState): boolean {
  switch (op.type) {
    case 'addSheet':
      return state.sheets.length < LIMITS.maxSheets && sheetNameIsValid(op.name, state, null);
    case 'renameSheet':
      return sheetNameIsValid(op.name, state, op.sheetId);
    case 'addChart':
      return chartRangeIsValid(op, state) && !state.charts.some((chart) => chart.id === op.chartId);
    case 'removeChart':
      return state.charts.some((chart) => chart.id === op.chartId);
    default:
      return true;
  }
}

function ensureCell(state: WorkbookState, sheetId: string, ref: string, seq: number, authorId: string) {
  const sheet = findSheetById(state, sheetId);
  if (!sheet) return null;
  let cell = sheet.cells.get(ref);
  if (!cell) {
    cell = { input: '', numberFormat: 'general', bold: false, lastSeq: seq, lastAuthorId: authorId };
    sheet.cells.set(ref, cell);
  }
  return cell;
}

/** Applies one op to the derived state. Callers have already decided the op is allowed. */
export function applyOp(state: WorkbookState, op: StoredOp, seq: number, authorId: string): void {
  switch (op.type) {
    case 'setCell': {
      const cell = ensureCell(state, op.sheetId, op.cell, seq, authorId);
      if (!cell) return;
      cell.input = op.input;
      cell.lastSeq = seq;
      cell.lastAuthorId = authorId;
      if (parseInput(op.input).kind === 'date') cell.numberFormat = 'date';
      return;
    }
    case 'setFormat': {
      const parsed = parseRangeRef(op.range);
      if (!parsed) return;
      for (let row = parsed.startRow; row <= parsed.endRow; row++) {
        for (let col = parsed.startCol; col <= parsed.endCol; col++) {
          const ref = `${String.fromCharCode(64 + col)}${row}`;
          const cell = ensureCell(state, op.sheetId, ref, seq, authorId);
          if (!cell) return;
          if (op.format.numberFormat !== undefined) cell.numberFormat = op.format.numberFormat;
          if (op.format.bold !== undefined) cell.bold = op.format.bold;
        }
      }
      return;
    }
    case 'addSheet': {
      state.sheets.push({ id: op.sheetId, name: op.name, position: state.sheets.length, cells: new Map() });
      return;
    }
    case 'renameSheet': {
      const sheet = findSheetById(state, op.sheetId);
      if (!sheet) return;
      const oldName = sheet.name;
      sheet.name = op.name;
      if (oldName.toLowerCase() === op.name.toLowerCase()) return;
      for (const other of state.sheets) {
        for (const cell of other.cells.values()) {
          if (!cell.input.startsWith('=')) continue;
          cell.input = `=${rewriteSheetNameInFormula(cell.input.slice(1), oldName, op.name)}`;
        }
      }
      return;
    }
    case 'addChart': {
      const split = splitQualified(op.range);
      state.charts.push({
        id: op.chartId,
        sheetId: op.sheetId,
        chartType: op.chartType,
        title: op.title,
        range: (split?.rest ?? op.range).toUpperCase(),
      });
      return;
    }
    case 'removeChart': {
      state.charts = state.charts.filter((chart) => chart.id !== op.chartId);
      return;
    }
    case 'restore': {
      applyRestore(state, op.snapshot, seq, authorId);
      return;
    }
  }
}

function applyRestore(state: WorkbookState, snapshot: WorkbookSnapshot, seq: number, authorId: string): void {
  const previous = new Map<string, Map<string, CellRecord>>();
  for (const sheet of state.sheets) {
    previous.set(sheet.id, new Map(sheet.cells));
  }
  state.sheets = snapshot.sheets.map((sheet) => {
    const before = previous.get(sheet.id);
    const cells = new Map<string, CellRecord>();
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const old = before?.get(ref);
      const unchanged = old && old.input === cell.input;
      cells.set(ref, {
        input: cell.input,
        numberFormat: cell.numberFormat,
        bold: cell.bold,
        lastSeq: unchanged ? old.lastSeq : seq,
        lastAuthorId: unchanged ? old.lastAuthorId : authorId,
      });
    }
    for (const [ref, old] of before ?? []) {
      if (!cells.has(ref) && old.input !== '') {
        cells.set(ref, { input: '', numberFormat: 'general', bold: false, lastSeq: seq, lastAuthorId: authorId });
      }
    }
    return { id: sheet.id, name: sheet.name, position: sheet.position, cells };
  });
  state.charts = snapshot.charts.map((chart) => ({ ...chart }));
}
