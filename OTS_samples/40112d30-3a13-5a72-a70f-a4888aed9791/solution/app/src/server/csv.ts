import type { Question } from '../shared/types.ts';
import { numberText } from './engine/index.ts';
import type { Submitted } from './submitted.ts';
import { isoWithOffset } from './time.ts';

// CSV export cells (brief: CSV export): UTF-8, CRLF, RFC 4180 quoting, text cells that start like a spreadsheet
// formula get a leading apostrophe.

const DANGEROUS = new Set(['=', '+', '-', '@', '\t', '\r']);

interface Column { name: string; key: string; row?: string }

function columnsFor(questions: Question[]): Column[] {
  return questions.flatMap((q): Column[] =>
    q.type === 'grid' ? (q.rows ?? []).map((row) => ({ name: `${q.key}.${row.value}`, key: q.key, row: row.value })) : [{ name: q.key, key: q.key }]);
}

const quote = (cell: string): string => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
const neutral = (cell: string): string => (cell !== '' && DANGEROUS.has(cell[0] ?? '') ? `'${cell}` : cell);

function cell(row: Submitted, column: Column): string {
  const q = row.res.questions.find((candidate) => candidate.key === column.key);
  if (!q || q.state !== 'lit') return '';
  if (q.type === 'calculated') {
    if (!q.calc || q.calc.failed || q.calc.value === null) return '';
    return q.calc.numeric ? q.calc.body : neutral(q.calc.body);
  }
  const value = q.value;
  if (value === null) return '';
  switch (q.type) {
    case 'number':
    case 'scale': return typeof value === 'string' ? numberText(value) : '';
    case 'date': return typeof value === 'string' ? value : '';
    case 'grid': return neutral((value as Record<string, string>)[column.row ?? ''] ?? '');
    case 'checkbox': {
      const ticked = value as string[];
      const order = (row.def.pages.flatMap((p) => p.questions).find((c) => c.key === q.key)?.options ?? []).map((o) => o.value);
      return neutral(order.filter((v) => ticked.includes(v)).join('; '));
    }
    case 'ranking': return neutral((value as string[]).join(' > '));
    case 'file': return neutral((value as { name: string }).name);
    default: return neutral(String(value));
  }
}

export function toCsv(rows: Submitted[], newest: Question[]): string {
  const known = new Set(newest.map((q) => q.key));
  const older: Question[] = [];
  for (const row of rows) {
    for (const q of row.def.pages.flatMap((p) => p.questions)) {
      if (!known.has(q.key)) {
        known.add(q.key);
        older.push(q);
      }
    }
  }
  const columns = columnsFor([...newest, ...older]);
  const lines = [['response_id', 'submitted_at', 'edition', ...columns.map((c) => c.name)].map(quote).join(',')];
  for (const row of rows) {
    const cells = [row.id, isoWithOffset(row.submittedAt), String(row.edition), ...columns.map((c) => cell(row, c))];
    lines.push(cells.map(quote).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
