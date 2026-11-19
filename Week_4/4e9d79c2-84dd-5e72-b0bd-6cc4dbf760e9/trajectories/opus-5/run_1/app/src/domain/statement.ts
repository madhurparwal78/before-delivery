import { Pennies, moneyString, parseStatementAmount } from './money.js';
import { CsvRow, findReference, readCsv } from './text.js';
import { isDateString } from './time.js';

export const STATEMENT_HEADER = 'Date,Description,Amount,Balance';
export const STATEMENT_MAX_ROWS = 2000;

export type StatementRow = {
  row: number;
  date: string;
  description: string;
  amount: Pennies;
  balance: Pennies;
  reference: string | null;
};

export type RefusedRow = { row: number; message: string };

export type StatementReading =
  | { ok: false; message: string }
  | { ok: true; rows: StatementRow[]; refused: RefusedRow[] };

function readStatementDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return isDateString(date) ? date : null;
}

export function readStatement(text: string): StatementReading {
  const lines: CsvRow[] = readCsv(text);
  const header = lines[0];
  if (!header || header.cells.map((cell) => cell.trim()).join(',') !== STATEMENT_HEADER) {
    return { ok: false, message: 'The first line has to read Date,Description,Amount,Balance.' };
  }
  const body = lines.slice(1).filter((line) => line.cells.some((cell) => cell.trim() !== ''));
  if (body.length > STATEMENT_MAX_ROWS) {
    return { ok: false, message: 'This file has more than 2,000 rows.' };
  }
  const rows: StatementRow[] = [];
  const refused: RefusedRow[] = [];
  for (const line of body) {
    const [dateText = '', description = '', amountText = '', balanceText = ''] = line.cells;
    const date = readStatementDate(dateText);
    if (!date) {
      refused.push({ row: line.row, message: `Row ${line.row}: ${dateText.trim()} is not a real date.` });
      continue;
    }
    const amount = parseStatementAmount(amountText);
    if (amount === null) {
      refused.push({ row: line.row, message: `Row ${line.row}: ${amountText.trim()} is not an amount.` });
      continue;
    }
    const balance = parseStatementAmount(balanceText);
    if (balance === null) {
      refused.push({ row: line.row, message: `Row ${line.row}: ${balanceText.trim()} is not an amount.` });
      continue;
    }
    rows.push({
      row: line.row,
      date,
      description: description.trim(),
      amount,
      balance,
      reference: findReference(description),
    });
  }
  return { ok: true, rows, refused };
}

export function statementRowKey(row: { date: string; description: string; amount: Pennies; balance: Pennies }): string {
  return [row.date, row.description, moneyString(row.amount), moneyString(row.balance)].join('|');
}
