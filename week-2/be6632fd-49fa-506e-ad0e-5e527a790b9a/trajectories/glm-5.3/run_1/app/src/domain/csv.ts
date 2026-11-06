// CSV cells: fields quoted when they contain a comma, quote or line break, and
// formula-like cells neutralised with a leading apostrophe. Decided here alone.
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(c => typeof c === 'number' ? String(c) : csvCell(c)).join(',');
}

export function csvDocument(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => csvRow(r)).join('\r\n') + '\r\n';
}

// The previous tool's semicolon format amounts use decimal commas and dot
// thousands separators (2.799,00), and editions are whole numbers that may use
// dot thousands (1.200).
export function parseLegacyAmount(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return null;
  const negative = /^-\d{1,3}(\.\d{3})*(,\d+)?$|^- \d+(,\d+)?$/.test(t);
  const withoutThousands = t.replace(/\./g, '').replace(',', '.');
  const n = Number(withoutThousands);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.round(n * 100) : Math.round(n * 100);
}

export function parseLegacyInteger(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(t)) return null;
  return Number(t.replace(/\./g, ''));
}
