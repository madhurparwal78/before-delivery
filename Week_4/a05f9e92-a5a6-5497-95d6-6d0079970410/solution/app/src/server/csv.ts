/** CSV cells with formula neutralisation: text that starts with a formula character gets a leading apostrophe. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" || typeof value === "bigint" ? String(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvText(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
