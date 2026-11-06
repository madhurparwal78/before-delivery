// CSV exports (brief: Business rules → Line-sheet export): UTF-8 without BOM, CRLF, RFC 4180 quoting, and any
// text cell starting with =, +, -, @, a tab or a carriage return neutralised with a leading apostrophe.
type Cell = string | number | null;

function csvCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(rows: Cell[][]): Buffer {
  return Buffer.from(rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join(""), "utf8");
}

export function csvReply(rows: Cell[][], filename: string): { status: number; bytes: Buffer; contentType: string; headers: Record<string, string> } {
  return { status: 200, bytes: csvText(rows), contentType: "text/csv; charset=utf-8", headers: { "Content-Disposition": `attachment; filename="${filename}"` } };
}
