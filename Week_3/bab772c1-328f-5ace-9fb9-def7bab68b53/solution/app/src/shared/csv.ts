/** RFC 4180 records with formula neutralisation, used by the event list download. */

const FORMULA_STARTS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** A text cell: neutralised when it starts with a formula character, then quoted. */
export function textCell(value: string): string {
  const neutralised = FORMULA_STARTS.has(value.slice(0, 1)) ? `'${value}` : value;
  return quote(neutralised);
}

/** A numeric cell: never neutralised, so a leading minus survives. */
export function numericCell(value: string): string {
  return quote(value);
}

export function csvDocument(records: readonly string[][]): string {
  return records.map((record) => `${record.join(",")}\r\n`).join("");
}
