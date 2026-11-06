// Door roster CSV (adapted from kit/modules/csv_safe): RFC 4180 quoting, CRLF line ends, and a
// leading "'" on any cell a spreadsheet would run as a formula.

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

function csvCell(value: string): string {
  const neutralised = FORMULA_START.has(value.charAt(0)) ? `'${value}` : value;
  const needsQuotes = ['"', ',', '\r', '\n'].some((char) => neutralised.includes(char));
  return needsQuotes ? `"${neutralised.replaceAll('"', '""')}"` : neutralised;
}

export function csvText(rows: string[][]): string {
  return rows.map((row) => `${row.map(csvCell).join(',')}\r\n`).join('');
}
