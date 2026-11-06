/**
 * Write one CSV cell: neutralise a spreadsheet-formula leading character, then
 * quote per RFC 4180. Only the first character counts for neutralising.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  const first = s.charCodeAt(0);
  if (first === 61 || first === 43 || first === 45 || first === 64 || first === 9 || first === 13) {
    s = `'` + s;
  }
  if (/["\r\n,]/.test(s)) {
    s = `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function csvLine(cells) {
  return cells.map(csvCell).join(',') + '\r\n';
}
