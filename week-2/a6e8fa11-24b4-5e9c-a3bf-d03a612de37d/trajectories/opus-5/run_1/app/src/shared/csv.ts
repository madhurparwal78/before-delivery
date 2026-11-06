import { CellValue } from './values';

/** Text results whose display could be read as a formula get a leading apostrophe. */
export function csvField(value: CellValue, display: string): string {
  const isText = typeof value === 'string';
  const needsNeutralising = isText && /^[=+\-@]/.test(display);
  return needsNeutralising ? `'${display}` : display;
}

export function csvQuote(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function csvLine(fields: string[]): string {
  return fields.map(csvQuote).join(',');
}

export function csvDocument(rows: string[][]): string {
  return rows.map(csvLine).join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}
