/** The one place that neutralises and quotes a ledger CSV field. */

const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** A text field that starts with a formula character takes a single leading quote. */
export function neutralise(field: string): string {
  const first = field.slice(0, 1);
  return FORMULA_STARTS.has(first) ? `'${field}` : field;
}

/** Quoting happens after neutralisation, and only when the field needs it. */
export function quote(field: string): string {
  if (!/[",\n]/.test(field)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

/** A text column of the ledger CSV: neutralised, then quoted. */
export function textField(value: string): string {
  return quote(neutralise(value));
}

/** A numeric column: never neutralised, so a negative amount stays as it is. */
export function numberField(value: number | string): string {
  return String(value);
}

export const LEDGER_CSV_HEADER =
  'line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason';

export interface LedgerCsvRow {
  readonly line_id: number;
  readonly pair_id: string;
  readonly posted_at: string;
  readonly account: string;
  readonly amount_mm2: number;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly actor_email: string;
  readonly reason: string;
}

export function ledgerCsvRow(row: LedgerCsvRow): string {
  return [
    numberField(row.line_id),
    numberField(row.pair_id),
    numberField(row.posted_at),
    textField(row.account),
    numberField(row.amount_mm2),
    textField(row.stock_code),
    textField(row.drawing_code),
    textField(row.actor_email),
    textField(row.reason),
  ].join(',');
}
