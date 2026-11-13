// CSV cell neutralisation and quoting, written once.

const FORMULA_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function csvCell(value: string, text: boolean): string {
  let cell = value;
  if (text && cell.length > 0 && FORMULA_CHARS.has(cell[0])) {
    cell = `'${cell}`;
  }
  if (/["\r\n,]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function csvRecord(cells: string[]): string {
  return `${cells.join(",")}\r\n`;
}
