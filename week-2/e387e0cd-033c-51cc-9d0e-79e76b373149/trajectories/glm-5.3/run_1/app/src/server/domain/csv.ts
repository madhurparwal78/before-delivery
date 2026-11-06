// The regulator's monthly file: UTF-8 CSV, every field quoted, CRLF lines,
// formula neutralisation.
export function csvCell(value: string | null | undefined): string {
  let v = value === null || value === undefined ? '' : value;
  if (v.startsWith('=') || v.startsWith('+') || v.startsWith('-') || v.startsWith('@') || v.startsWith('\t') || v.startsWith('\r')) {
    v = `'${v}`;
  }
  return `"${v.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export function csvDocument(rows: (string | null | undefined)[][]): string {
  const lines = rows.map((row) => csvRow(row));
  return `${lines.join('\r\n')}\r\n`;
}

export const REGULATOR_HEADER = [
  'Reference', 'Created at', 'Asset', 'Amount', 'Fiat value', 'Currency', 'Threshold', 'Rule in force since',
  'Rate', 'Counterparty name', 'Counterparty LEI', 'Counterparty jurisdiction', 'Counterparty rule', 'Path',
  'Status', 'Data sent via', 'Data sent at', 'Answer', 'Answer late', 'Answered at', 'Originator name',
  'Originator identity number', 'Originator date of birth', 'Beneficiary name', 'Closed at', 'Outcome',
];
