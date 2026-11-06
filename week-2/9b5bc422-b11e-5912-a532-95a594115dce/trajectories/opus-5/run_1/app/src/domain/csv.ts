import { csvCopy } from './copy.ts';
import { isCalendarDate, parseNumber } from './format.ts';
import { cellDisplay, cellValue } from './records.ts';
import type { CellValue, Column, RowRecord, TableRecord } from './types.ts';

export const CSV_BYTE_LIMIT = 1_000_000;

const FORMULA = /^'*[=+\-@]/;

/** A cell that could run as a formula gets one extra leading apostrophe. */
function neutralise(text: string): string {
  return FORMULA.test(text) ? `'${text}` : text;
}

function unneutralise(text: string): string {
  return /^''*[=+\-@]/.test(text) ? text.slice(1) : text;
}

function needsQuotes(text: string): boolean {
  return /[",\r\n]/.test(text);
}

function quote(text: string): string {
  return needsQuotes(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCell(value: CellValue, column: Column): string {
  const text = cellDisplay(value, column);
  if (column.type === 'text' || column.type === 'select') return neutralise(text);
  return text;
}

export function toCsv(table: TableRecord, rows: RowRecord[]): string {
  const lines: string[] = [];
  lines.push(table.columns.map((column) => quote(neutralise(column.name))).join(','));
  for (const row of rows) {
    lines.push(table.columns.map((column) => quote(exportCell(cellValue(row, column.id), column))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  const body = text.replace(/^\uFEFF/, '');
  while (index < body.length) {
    const character = body[index];
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += body[index] === '\r' && body[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += character;
    index += 1;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type ImportOutcome = {
  rows: Record<string, CellValue>[];
  messages: string[];
  imported: number;
  skipped: number;
};

export function fromCsv(table: TableRecord, text: string): ImportOutcome {
  const grid = parseCsv(text);
  const names = table.columns.map((column) => column.name);
  if (!grid.length) {
    return { rows: [], messages: [csvCopy.wrongColumns(names)], imported: 0, skipped: 0 };
  }
  const heading = grid[0].map((cell) => unneutralise(cell.trim()));
  const sameColumns =
    heading.length === names.length && [...heading].sort().join('\u0000') === [...names].sort().join('\u0000');
  if (!sameColumns) {
    return { rows: [], messages: [csvCopy.wrongColumns(names)], imported: 0, skipped: 0 };
  }

  const columnAt = heading.map((name) => table.columns.find((column) => column.name === name) as Column);
  const rows: Record<string, CellValue>[] = [];
  const messages: string[] = [];
  let skipped = 0;

  grid.slice(1).forEach((line, lineIndex) => {
    if (line.length === 1 && line[0].trim() === '') return;
    const rowNumber = lineIndex + 1;
    const cells: Record<string, CellValue> = {};
    const problems: string[] = [];
    columnAt.forEach((column, columnIndex) => {
      const raw = (line[columnIndex] ?? '').trim();
      if (column.type === 'text') {
        cells[column.id] = unneutralise(raw);
        return;
      }
      if (column.type === 'select') {
        const value = unneutralise(raw);
        if (!value) {
          cells[column.id] = null;
          return;
        }
        if (!(column.options ?? []).includes(value)) {
          problems.push(csvCopy.badOption(rowNumber, column.name));
          return;
        }
        cells[column.id] = value;
        return;
      }
      if (column.type === 'number') {
        if (!raw) {
          cells[column.id] = null;
          return;
        }
        const value = parseNumber(raw);
        if (value === null) {
          problems.push(csvCopy.badNumber(rowNumber, column.name));
          return;
        }
        cells[column.id] = value;
        return;
      }
      if (column.type === 'date') {
        if (!raw) {
          cells[column.id] = null;
          return;
        }
        if (!isCalendarDate(raw)) {
          problems.push(csvCopy.badDate(rowNumber, column.name));
          return;
        }
        cells[column.id] = raw;
        return;
      }
      if (!raw) {
        cells[column.id] = false;
        return;
      }
      const lowered = raw.toLowerCase();
      if (lowered !== 'true' && lowered !== 'false') {
        problems.push(csvCopy.badCheckbox(rowNumber, column.name));
        return;
      }
      cells[column.id] = lowered === 'true';
    });
    if (problems.length) {
      skipped += 1;
      messages.push(...problems);
      return;
    }
    rows.push(cells);
  });

  return {
    rows,
    messages: [csvCopy.summary(rows.length, skipped), ...messages],
    imported: rows.length,
    skipped,
  };
}
