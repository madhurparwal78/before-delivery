/**
 * Row resolution: SKU code, remembered alias, or normalised name plus converted
 * pack size — else ambiguous or unmatched, with the published reasons.
 */
import { parseMrp, parseRate } from './sheet.js';

export interface CatalogueSku {
  code: string;
  drinkId: string;
  drinkName: string;
  variant: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sizeMl: number;
}

export interface CatalogueDrink {
  id: string;
  name: string;
}

export interface Catalogue {
  drinks: CatalogueDrink[];
  skus: CatalogueSku[];
  aliases: Map<string, string>;
}

export type RowStatus = 'matched' | 'ambiguous' | 'unmatched' | 'settled';
export type MatchedBy = 'sku_code' | 'alias' | 'name_size' | null;
export type RowReason = 'no_pack_size' | 'several_sizes' | 'case_pack' | 'no_drink' | 'no_pack' | 'unreadable_values' | 'conflicting_prices' | null;

export interface ResolvedRow {
  raw: { code: string; description: string; newMrp: string; oldGst: string; newGst: string };
  status: RowStatus;
  matchedBy: MatchedBy;
  skuCode: string | null;
  candidates: string[];
  reason: RowReason;
  newMrpPaise: number | null;
  oldRate: number | null;
  newRate: number | null;
}

/** Exact decimal conversion with no floating-point error: `1.1 L` is 1100 ml. */
export function sizeToMl(numberText: string, unit: string): number | null {
  let t = numberText.replace(/,/g, '');
  if (t.startsWith('.')) t = '0' + t;
  const u = unit.toLowerCase();
  let factor: number;
  if (u === 'ml' || u === 'ml.') factor = 1;
  else if (u === 'l' || u === 'ltr' || u === 'ltr.' || u === 'liter' || u === 'litre') factor = 1000;
  else return null;
  // exact decimal conversion
  const dot = t.indexOf('.');
  let whole = t;
  let frac = '';
  if (dot !== -1) {
    whole = t.slice(0, dot);
    frac = t.slice(dot + 1);
  }
  if (!/^\d*$/.test(whole) || (frac !== '' && !/^\d*$/.test(frac))) return null;
  const scaled = Number(whole) * factor + (frac === '' ? 0 : (Number(frac) * factor) / Math.pow(10, frac.length));
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-9) return null; // not a whole number of ml
  return rounded;
}

const FORMAT_WORDS: Array<[RegExp, string]> = [
  [/\bpet\b/i, 'pet'],
  [/\bglass\b|\bgls\b/i, 'glass'],
  [/\bcan\b/i, 'can'],
  [/\bcartons?\b|\bctn\b/i, 'carton'],
];

export function normaliseDescription(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract size tokens and a case-pack marker from a description. */
function extractSize(desc: string): { ml: number | null; reason: RowReason; format: string | null; name: string } {
  const work = desc.replace(/\u00a0/g, ' ');
  // A size is a number, optionally comma-grouped, followed by an optional
  // separator then ml, l or ltr — so `1.2LTR`, `.5 L` and `1,000 ml` all read.
  const sizeRe = /(\d[\d,]*(?:\.\d+)?|\.\d+)[\s]*(ml|l|ltr)\b/gi;
  const spans: Array<{ start: number; end: number; ml: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sizeRe.exec(work)) !== null) {
    const value = sizeToMl(m[1], m[2]);
    if (value === null) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, ml: value });
  }
  if (spans.length === 0) {
    // a number with no unit, or no number at all
    return { ml: null, reason: 'no_pack_size', format: null, name: work };
  }
  const distinct = Array.from(new Set(spans.map((s) => s.ml)));
  if (distinct.length > 1) return { ml: null, reason: 'several_sizes', format: null, name: work };
  const first = spans[0];
  const after = work.slice(first.end).replace(/^\s+/, '');
  const casePackRe = /^(x|\*)\s*(\d+)\b/i;
  const cpm = casePackRe.exec(after);
  if (cpm) return { ml: null, reason: 'case_pack', format: null, name: work };
  let cleaned = work;
  for (const s of spans) {
    cleaned = cleaned.slice(0, s.start) + ' '.repeat(s.end - s.start) + cleaned.slice(s.end);
  }
  // remove format words
  let format: string | null = null;
  for (const [re, fmt] of FORMAT_WORDS) {
    if (re.test(cleaned)) {
      format = fmt;
      cleaned = cleaned.replace(re, ' ');
      break;
    }
  }
  return { ml: distinct[0], reason: null, format, name: cleaned };
}

/** Resolve one row against the catalogue. */
export function resolveRow(raw: { code: string; description: string; newMrp: string; oldGst: string; newGst: string }, catalogue: Catalogue): ResolvedRow {
  const base: ResolvedRow = {
    raw,
    status: 'unmatched',
    matchedBy: null,
    skuCode: null,
    candidates: [],
    reason: null,
    newMrpPaise: null,
    oldRate: null,
    newRate: null,
  };

  const newMrpPaise = parseMrp(raw.newMrp);
  const oldRate = parseRate(raw.oldGst);
  const newRate = parseRate(raw.newGst);
  if (newMrpPaise === null || (raw.oldGst === '') !== (raw.newGst === '')) {
    return { ...base, status: 'unmatched', reason: 'unreadable_values' };
  }
  base.newMrpPaise = newMrpPaise;
  base.oldRate = oldRate;
  base.newRate = newRate;

  // 1. SKU code
  if (raw.code) {
    const code = raw.code.toUpperCase();
    const hit = catalogue.skus.find((s) => s.code.toUpperCase() === code);
    if (hit) return { ...base, status: 'matched', matchedBy: 'sku_code', skuCode: hit.code };
  }

  // 2. Remembered alias
  const nd = normaliseDescription(raw.description);
  const aliasHit = catalogue.aliases.get(nd);
  if (aliasHit) return { ...base, status: 'matched', matchedBy: 'alias', skuCode: aliasHit };

  // 3. Name plus size
  const { ml, reason, format, name } = extractSize(raw.description);
  if (reason) return { ...base, reason };
  if (ml === null) return { ...base, reason: 'no_pack_size' };

  const normName = normaliseName(name);
  const fitting = catalogue.drinks.filter((d) => {
    const dn = normaliseName(d.name);
    return dn === normName || (normName !== '' && dn.startsWith(`${normName} `));
  });
  if (fitting.length === 0) return { ...base, reason: 'no_drink' };

  const drinkIds = new Set(fitting.map((d) => d.id));
  const candidates = catalogue.skus.filter((s) => drinkIds.has(s.drinkId) && s.sizeMl === ml && (format === null || s.format === format));
  if (candidates.length === 1) return { ...base, status: 'matched', matchedBy: 'name_size', skuCode: candidates[0].code };
  if (candidates.length === 0) return { ...base, reason: 'no_pack' };
  return { ...base, status: 'ambiguous', candidates: candidates.map((c) => c.code) };
}
