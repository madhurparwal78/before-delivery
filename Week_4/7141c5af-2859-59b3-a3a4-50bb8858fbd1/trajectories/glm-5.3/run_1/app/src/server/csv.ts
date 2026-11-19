export const WORKBOOK_COLUMNS = ["client", "piece", "maker", "year", "stamp", "material", "notes"] as const;

export type DelimitedFile = { header: string[]; raw: string[][] };

/** Parse CSV with optional BOM, LF or CRLF, comma or semicolon, quoted fields with line breaks. */
export function parseDelimited(text: string): DelimitedFile {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.slice(0, s.indexOf("\n") === -1 ? s.length : s.indexOf("\n"));
  const sep = firstLine.split('"').length > 2
    ? (firstLine.replace(/"[^"]*"/g, "").includes(";") ? ";" : ",")
    : (firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c === "\r") {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);
  const clean = rows.filter((r, i) => !(i === rows.length - 1 && r.length === 1 && r[0] === ""));
  return { header: clean[0] ?? [], raw: clean.slice(1) };
}

/** Materials list file cell quoting; dangerous cells carry an apostrophe. */
export function csvCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-\@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
