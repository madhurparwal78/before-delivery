import type { CellKind } from '../shared/api.js';
import { cellKey, type Snapshot } from './evaluate.js';
import type { TableData } from './model.js';

const NEUTRALISE_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function isTextOrigin(kind: CellKind): boolean {
  return kind === 'text' || kind === 'reference';
}

/** A value of text origin that starts with a formula character gets an apostrophe. */
export function neutralise(value: string, textOrigin: boolean): string {
  if (!textOrigin) return value;
  const first = value.slice(0, 1);
  return NEUTRALISE_PREFIXES.includes(first) ? `'${value}` : value;
}

function quote(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function buildCsv(snapshot: Snapshot, table: TableData): Buffer {
  const lines: string[] = [];
  lines.push(
    table.columns.map((column) => quote(neutralise(column.name, true))).join(','),
  );
  const rowIds =
    table.kind === 'summary'
      ? (snapshot.groups.get(table.id) ?? []).map((group) => group.id)
      : (snapshot.visible.get(table.id) ?? []).map((row) => row.id);
  for (const rowId of rowIds) {
    const fields = table.columns.map((column) => {
      const cell = snapshot.cells.get(cellKey(rowId, column.id));
      if (cell === undefined) return '';
      return quote(neutralise(cell.display, isTextOrigin(cell.kind)));
    });
    lines.push(fields.join(','));
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

const DISPOSITION_KEEP = /[A-Za-z0-9!#$&+\-.^_`|~]/;

export function contentDisposition(fileName: string): string {
  const ascii = Array.from(fileName)
    .map((character) => {
      const code = character.codePointAt(0) as number;
      if (character === '"' || character === '\\') return '_';
      return code >= 0x20 && code <= 0x7e ? character : '_';
    })
    .join('');
  const encoded = [...Buffer.from(fileName, 'utf8')]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return DISPOSITION_KEEP.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
