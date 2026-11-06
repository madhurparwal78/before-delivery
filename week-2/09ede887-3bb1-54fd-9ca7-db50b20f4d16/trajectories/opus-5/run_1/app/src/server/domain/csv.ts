const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Neutralises a cell a spreadsheet would otherwise run as a formula. */
function neutralise(value: string): string {
  const first = value[0];
  return first !== undefined && FORMULA_LEADERS.has(first) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header.map(quote).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => quote(neutralise(cell))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
