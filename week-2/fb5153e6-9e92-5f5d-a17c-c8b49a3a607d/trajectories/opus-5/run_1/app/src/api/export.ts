import type { SearchDocument } from '../services/search.js';
import { centsToEuroString } from '../domain/money.js';

const FORMULA_STARTERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Spreadsheet formula characters are neutralised with a leading apostrophe. */
function neutralise(cell: string): string {
  const first = cell[0];
  return first !== undefined && FORMULA_STARTERS.has(first) ? `'${cell}` : cell;
}

function quote(cell: string): string {
  if (!/[",\n\r]/.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

function field(value: string): string {
  return quote(neutralise(value));
}

export const CSV_HEADER = 'slug,title,category,formats,licences,price_from_eur,published_on';

/** One row per catalogue model, newest first, with CRLF line endings. */
export function buildCatalogueCsv(documents: readonly SearchDocument[]): string {
  const lines = [CSV_HEADER];
  for (const document of documents) {
    lines.push(
      [
        field(document.slug),
        field(document.title),
        field(document.category),
        field(document.formats.join(';')),
        field(document.licences.join(';')),
        field(centsToEuroString(document.price_from_cents)),
        field(new Date(document.published_at * 1000).toISOString().slice(0, 10)),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
