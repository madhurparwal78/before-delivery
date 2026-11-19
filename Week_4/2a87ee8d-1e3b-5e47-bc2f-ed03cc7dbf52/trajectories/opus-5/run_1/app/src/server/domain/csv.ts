/**
 * The one place the CSV cell rule lives. A cell whose first character is =, +, -, @,
 * a tab or a carriage return is written with an apostrophe in front, so a spreadsheet
 * shows it as text. Quoting follows RFC 4180 and lines end with CRLF.
 */

const RISKY_FIRST_CHARACTERS = new Set(['=', '+', '-', '@', '\t', '\r']);

function makeCellInert(value: string): string {
  const first = value.charAt(0);
  return RISKY_FIRST_CHARACTERS.has(first) ? `'${value}` : value;
}

function quoteCell(value: string): string {
  const inert = makeCellInert(value);
  if (/[",\r\n]/.test(inert)) return `"${inert.replace(/"/g, '""')}"`;
  return inert;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(quoteCell).join(',');
}

const CSV_HEADER = ['frame', 'cluster', 'note', 'cluster_dots'] as const;

/** UTF-8 without a byte-order mark, CRLF line endings. */
export function renderCsv(rows: ReadonlyArray<readonly string[]>): Buffer {
  const lines = [csvRow(CSV_HEADER), ...rows.map(csvRow)];
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}
