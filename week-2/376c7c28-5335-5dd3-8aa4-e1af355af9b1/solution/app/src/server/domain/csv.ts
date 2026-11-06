/** CSV cell neutralisation and quoting, decided only here. */

const RISKY_FIRST = new Set(['=', '+', '-', '@', '\t', '\r']);

function csvCell(value: string): string {
  const first = value.charAt(0);
  const neutral = RISKY_FIRST.has(first) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutral)) {
    return `"${neutral.replace(/"/g, '""')}"`;
  }
  return neutral;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

export function csvDocument(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [csvRow(header)];
  for (const row of rows) lines.push(csvRow(row));
  return `${lines.join('\r\n')}\r\n`;
}
