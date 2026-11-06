const FORMULA_STARTERS = new Set(['=', '+', '-', '@']);

/** The one place CSV cells are neutralised and quoted. */
export function csvCell(value: string): string {
  const first = value.charAt(0);
  const neutralised = FORMULA_STARTERS.has(first) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralised)) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}

export function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

export function csvDocument(header: string[], rows: string[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
