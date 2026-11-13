import type { PriceBook, SkuRecord } from '../domain/price.js';
import { collapseSpaces, parseMrpPaise, parseRate, rateIsBlank, type RawSheetRow } from './parse.js';

export type RowStatus = 'matched' | 'ambiguous' | 'unmatched' | 'settled';
export type MatchedBy = 'sku_code' | 'alias' | 'name_size' | null;
export type RowReason =
  | 'no_pack_size'
  | 'several_sizes'
  | 'case_pack'
  | 'no_drink'
  | 'no_pack'
  | 'unreadable_values'
  | 'conflicting_prices'
  | null;

export interface SheetRowState {
  rowNumber: number;
  raw: { code: string | null; description: string | null; newMrp: string | null; oldGst: string | null; newGst: string | null };
  status: RowStatus;
  matchedBy: MatchedBy;
  skuCode: string | null;
  candidates: string[];
  reason: RowReason;
  newMrpPaise: number | null;
  oldRate: number | null;
  newRate: number | null;
  mergedIntoRow: number | null;
  ignored: boolean;
  finalSettled: boolean;
}

const FORMAT_WORDS: { word: string; format: string }[] = [
  { word: 'pet', format: 'pet' },
  { word: 'glass', format: 'glass' },
  { word: 'gls', format: 'glass' },
  { word: 'can', format: 'can' },
  { word: 'carton', format: 'carton' },
  { word: 'ctn', format: 'carton' },
];

export function normaliseDescription(description: string | null): string {
  return collapseSpaces(description ?? '').toLowerCase();
}

interface SizeReading {
  millilitres: number[];
  casePack: boolean;
  unreadableSize: boolean;
  stripped: string;
}

/** Exact decimal conversion to whole millilitres, so `1.1 L` is 1100 ml. */
function toMillilitres(number: string, unit: string): number | null {
  const plain = number.replace(/,/g, '');
  const [whole, fraction = ''] = plain.split('.');
  const digits = `${whole === '' ? '0' : whole}${fraction}`;
  const scale = fraction.length;
  const asInteger = Number(digits);
  const multiplier = unit === 'ml' ? 1 : 1000;
  const scaled = asInteger * multiplier;
  const divisor = 10 ** scale;
  if (scaled % divisor !== 0) return null;
  return scaled / divisor;
}

function readSizes(description: string): SizeReading {
  const pattern = /(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(ml|ltr|l)(?![a-z0-9])\s*(?:([x*])\s*(\d+))?/gi;
  const millilitres: number[] = [];
  let casePack = false;
  let unreadableSize = false;
  const stripped = description.replace(pattern, (_match, number: string, unit: string, marker?: string) => {
    const value = toMillilitres(number, unit.toLowerCase() === 'ml' ? 'ml' : 'l');
    if (value === null) unreadableSize = true;
    else millilitres.push(value);
    if (marker !== undefined) casePack = true;
    return ' ';
  });
  return { millilitres, casePack, unreadableSize, stripped };
}

function nameFrom(stripped: string): { name: string; format: string | null } {
  let format: string | null = null;
  const words = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '');
  const kept: string[] = [];
  for (const word of words) {
    const formatWord = FORMAT_WORDS.find((entry) => entry.word === word);
    if (formatWord !== undefined) {
      format = formatWord.format;
      continue;
    }
    kept.push(word);
  }
  return { name: kept.join(' '), format };
}

function drinkFits(name: string, drinkName: string): boolean {
  const normalised = drinkName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (name === normalised) return true;
  return normalised.startsWith(`${name} `) && name !== '';
}

export interface ResolveContext {
  book: PriceBook;
  aliases: Map<string, string>;
}

/** Reads one imported row: SKU code, then remembered alias, then name plus size. */
export function resolveRow(raw: RawSheetRow, context: ResolveContext): SheetRowState {
  const newMrpPaise = parseMrpPaise(raw.newMrp);
  const oldBlank = rateIsBlank(raw.oldGst);
  const newBlank = rateIsBlank(raw.newGst);
  const oldRate = oldBlank ? null : parseRate(raw.oldGst);
  const newRate = newBlank ? null : parseRate(raw.newGst);
  const base: SheetRowState = {
    rowNumber: raw.rowNumber,
    raw: {
      code: raw.code,
      description: raw.description,
      newMrp: raw.newMrp,
      oldGst: raw.oldGst,
      newGst: raw.newGst,
    },
    status: 'unmatched',
    matchedBy: null,
    skuCode: null,
    candidates: [],
    reason: null,
    newMrpPaise,
    oldRate,
    newRate,
    mergedIntoRow: null,
    ignored: false,
    finalSettled: false,
  };

  const ratesUnreadable =
    newMrpPaise === null ||
    oldBlank !== newBlank ||
    (!oldBlank && oldRate === null) ||
    (!newBlank && newRate === null) ||
    (oldRate !== null && newRate !== null && oldRate === newRate);
  if (ratesUnreadable) {
    return { ...base, status: 'unmatched', reason: 'unreadable_values' };
  }

  const code = collapseSpaces(raw.code ?? '').toUpperCase();
  if (code !== '' && context.book.sku(code) !== null) {
    return { ...base, status: 'matched', matchedBy: 'sku_code', skuCode: code };
  }

  const normalised = normaliseDescription(raw.description);
  const alias = context.aliases.get(normalised);
  if (alias !== undefined) {
    return { ...base, status: 'matched', matchedBy: 'alias', skuCode: alias };
  }

  const sizes = readSizes(collapseSpaces(raw.description ?? ''));
  const distinct = [...new Set(sizes.millilitres)];
  if (sizes.unreadableSize || distinct.length === 0) {
    return { ...base, status: 'unmatched', reason: 'no_pack_size' };
  }
  if (distinct.length > 1) {
    return { ...base, status: 'unmatched', reason: 'several_sizes' };
  }
  if (sizes.casePack) {
    return { ...base, status: 'unmatched', reason: 'case_pack' };
  }
  const sizeMl = distinct[0];
  const { name, format } = nameFrom(sizes.stripped);
  const drinks = context.book.drinks().filter((drink) => drinkFits(name, drink.name));
  if (drinks.length === 0) {
    return { ...base, status: 'unmatched', reason: 'no_drink' };
  }
  const drinkIds = new Set(drinks.map((drink) => drink.id));
  const candidates: SkuRecord[] = context.book
    .skus()
    .filter(
      (sku) =>
        drinkIds.has(sku.drinkId) && sku.sizeMl === sizeMl && (format === null || sku.format === format),
    );
  if (candidates.length === 1) {
    return { ...base, status: 'matched', matchedBy: 'name_size', skuCode: candidates[0].code };
  }
  if (candidates.length === 0) {
    return { ...base, status: 'unmatched', reason: 'no_pack' };
  }
  return {
    ...base,
    status: 'ambiguous',
    candidates: candidates.map((sku) => sku.code),
  };
}

function sameValues(a: SheetRowState, b: SheetRowState): boolean {
  return a.newMrpPaise === b.newMrpPaise && a.oldRate === b.oldRate && a.newRate === b.newRate;
}

/** The published duplicate rule: merge equal rows, reopen rows whose values differ. */
export function applyDuplicateRule(rows: SheetRowState[]): SheetRowState[] {
  const next = rows.map((row) => ({ ...row, mergedIntoRow: null as number | null }));
  const groups = new Map<string, SheetRowState[]>();
  for (const row of next) {
    if (row.ignored || row.skuCode === null) continue;
    if (row.status !== 'matched' && row.status !== 'settled') continue;
    const list = groups.get(row.skuCode) ?? [];
    list.push(row);
    groups.set(row.skuCode, list);
  }
  for (const [skuCode, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.rowNumber - b.rowNumber);
    const allSame = ordered.every((row) => sameValues(row, ordered[0]));
    if (allSame) {
      for (const row of ordered.slice(1)) row.mergedIntoRow = ordered[0].rowNumber;
      continue;
    }
    for (const row of ordered) {
      if (row.finalSettled) continue;
      row.status = 'ambiguous';
      row.reason = 'conflicting_prices';
      row.candidates = [skuCode];
      row.matchedBy = null;
      row.ignored = false;
    }
  }
  return next;
}

export function rowIsOpen(row: SheetRowState): boolean {
  return row.status === 'ambiguous' || row.status === 'unmatched';
}

export function sheetCounts(rows: SheetRowState[]): {
  matched: number;
  ambiguous: number;
  unmatched: number;
  settled: number;
} {
  return {
    matched: rows.filter((row) => row.status === 'matched').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous').length,
    unmatched: rows.filter((row) => row.status === 'unmatched').length,
    settled: rows.filter((row) => row.status === 'settled').length,
  };
}

export function draftableRows(rows: SheetRowState[]): SheetRowState[] {
  return rows.filter(
    (row) =>
      (row.status === 'matched' || row.status === 'settled') &&
      !row.ignored &&
      row.mergedIntoRow === null &&
      row.skuCode !== null,
  );
}
