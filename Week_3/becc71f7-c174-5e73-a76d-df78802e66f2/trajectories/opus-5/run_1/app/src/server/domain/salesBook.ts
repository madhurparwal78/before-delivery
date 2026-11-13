/**
 * The sales book file: every field in double quotes, CRLF line ends, and an apostrophe
 * before any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return.
 */

import { formatSheetDateTime, type BrusselsMonth } from '../../shared/brussels.js';
import { formatAmountPlain } from '../../shared/money.js';

const HEADER = [
  'Sale date',
  'Tag code',
  'Description',
  'Sale price',
  'Consignor share',
  'Commission',
  'VAT',
];

const RISKY_FIRST_CHARACTERS = ['=', '+', '-', '@', '\t', '\r'];

function cell(value: string): string {
  const guarded = RISKY_FIRST_CHARACTERS.includes(value.charAt(0)) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function line(values: readonly string[]): string {
  return `${values.map(cell).join(',')}\r\n`;
}

export interface SalesBookLine {
  soldAt: number;
  tagCode: string;
  description: string;
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
}

export interface SalesBookTotals {
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
}

export function totalsOf(lines: readonly SalesBookLine[]): SalesBookTotals {
  return lines.reduce<SalesBookTotals>(
    (sum, entry) => ({
      priceCents: sum.priceCents + entry.priceCents,
      consignorShareCents: sum.consignorShareCents + entry.consignorShareCents,
      commissionCents: sum.commissionCents + entry.commissionCents,
      vatCents: sum.vatCents + entry.vatCents,
    }),
    { priceCents: 0, consignorShareCents: 0, commissionCents: 0, vatCents: 0 },
  );
}

export function salesBookFileName(month: BrusselsMonth): string {
  return `sales-book-${month}.csv`;
}

export function renderSalesBook(lines: readonly SalesBookLine[]): string {
  const totals = totalsOf(lines);
  return [
    line(HEADER),
    ...lines.map((entry) =>
      line([
        formatSheetDateTime(entry.soldAt),
        entry.tagCode,
        entry.description,
        formatAmountPlain(entry.priceCents),
        formatAmountPlain(entry.consignorShareCents),
        formatAmountPlain(entry.commissionCents),
        formatAmountPlain(entry.vatCents),
      ]),
    ),
    line([
      'Total',
      '',
      '',
      formatAmountPlain(totals.priceCents),
      formatAmountPlain(totals.consignorShareCents),
      formatAmountPlain(totals.commissionCents),
      formatAmountPlain(totals.vatCents),
    ]),
  ].join('');
}
