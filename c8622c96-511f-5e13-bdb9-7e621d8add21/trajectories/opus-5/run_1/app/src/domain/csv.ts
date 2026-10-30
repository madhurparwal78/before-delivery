const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

/** A cell starting with a formula character is written with a leading apostrophe. */
export function neutraliseCsvCell(value: string): string {
  const first = value.slice(0, 1);
  return FORMULA_STARTS.includes(first) ? `'${value}` : value;
}

function quote(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** UTF-8 CSV with CRLF line endings and RFC 4180 quoting, every data cell neutralised. */
export function renderCsv(header: string[], rows: string[][]): string {
  const lines = [header.map(quote).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => quote(neutraliseCsvCell(cell))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
