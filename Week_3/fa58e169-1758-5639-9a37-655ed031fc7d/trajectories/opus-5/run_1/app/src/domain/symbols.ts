import type { Craft, Side, Terms } from './types';

export const NO_STITCH = 'ns';
export const CABLE = 'c22';
export const CABLE_CELLS = 4;
export const CABLE_TEXT = '2/2 LC';

export interface StitchSymbol {
  key: string;
  name: string;
  letterKey: string;
  /** Right-side text for knitting, US text for crochet. */
  rsText: string;
  /** Wrong-side text for knitting, UK text for crochet. */
  wsText: string;
  uses: number;
  makes: number;
  /** A counted text always prints its count, even for one stitch. */
  counted: boolean;
  /** The pastel tile tint index of the symbol's family. */
  family: string;
}

const KNIT_SYMBOLS: StitchSymbol[] = [
  { key: 'k', name: 'Knit', letterKey: 'k', rsText: 'k', wsText: 'p', uses: 1, makes: 1, counted: true, family: 'plain' },
  { key: 'p', name: 'Purl', letterKey: 'p', rsText: 'p', wsText: 'k', uses: 1, makes: 1, counted: true, family: 'plain' },
  { key: 'yo', name: 'Yarn over', letterKey: 'o', rsText: 'yo', wsText: 'yo', uses: 0, makes: 1, counted: false, family: 'increase' },
  { key: 'k2tog', name: 'Knit two together', letterKey: 't', rsText: 'k2tog', wsText: 'p2tog', uses: 2, makes: 1, counted: false, family: 'decrease' },
  { key: 'ssk', name: 'Slip slip knit', letterKey: 's', rsText: 'ssk', wsText: 'ssp', uses: 2, makes: 1, counted: false, family: 'decrease' },
  { key: 'cdd', name: 'Centred double decrease', letterKey: 'd', rsText: 'cdd', wsText: 'cdp', uses: 3, makes: 1, counted: false, family: 'decrease' },
  { key: 'm1l', name: 'Make one left', letterKey: 'l', rsText: 'm1l', wsText: 'm1lp', uses: 0, makes: 1, counted: false, family: 'increase' },
  { key: 'm1r', name: 'Make one right', letterKey: 'r', rsText: 'm1r', wsText: 'm1rp', uses: 0, makes: 1, counted: false, family: 'increase' },
  { key: 'ns', name: 'No stitch', letterKey: 'x', rsText: '', wsText: '', uses: 0, makes: 0, counted: false, family: 'blank' },
  { key: 'c22', name: '2/2 cable', letterKey: 'c', rsText: CABLE_TEXT, wsText: CABLE_TEXT, uses: 1, makes: 1, counted: false, family: 'cable' },
];

const CROCHET_SYMBOLS: StitchSymbol[] = [
  { key: 'sc', name: 'Single crochet', letterKey: 's', rsText: 'sc', wsText: 'dc', uses: 1, makes: 1, counted: true, family: 'plain' },
  { key: 'hdc', name: 'Half double crochet', letterKey: 'h', rsText: 'hdc', wsText: 'htr', uses: 1, makes: 1, counted: true, family: 'plain' },
  { key: 'dc', name: 'Double crochet', letterKey: 'd', rsText: 'dc', wsText: 'tr', uses: 1, makes: 1, counted: true, family: 'tall' },
  { key: 'inc', name: 'Increase', letterKey: 'i', rsText: 'inc', wsText: 'inc', uses: 1, makes: 2, counted: false, family: 'increase' },
  { key: 'dec', name: 'Decrease', letterKey: 'e', rsText: 'dec', wsText: 'dec', uses: 2, makes: 1, counted: false, family: 'decrease' },
  { key: 'ns', name: 'No stitch', letterKey: 'x', rsText: '', wsText: '', uses: 0, makes: 0, counted: false, family: 'blank' },
];

export function symbolsFor(craft: Craft): StitchSymbol[] {
  return craft === 'knit' ? KNIT_SYMBOLS : CROCHET_SYMBOLS;
}

export function findSymbol(craft: Craft, key: string): StitchSymbol | undefined {
  return symbolsFor(craft).find((s) => s.key === key);
}

export function symbolByLetterKey(craft: Craft, letter: string): StitchSymbol | undefined {
  return symbolsFor(craft).find((s) => s.letterKey === letter);
}

/** The printed text of a symbol on a row of this side, in this pattern's terms. */
export function stitchText(symbol: StitchSymbol, craft: Craft, terms: Terms, side: Side): string {
  if (craft === 'crochet') return terms === 'uk' ? symbol.wsText : symbol.rsText;
  if (symbol.key === CABLE) return CABLE_TEXT;
  return side === 'WS' ? symbol.wsText : symbol.rsText;
}

export interface TextMatch {
  symbol: StitchSymbol;
  text: string;
}

/** Texts a row of this side accepts, mapped to the chart symbol they place. */
export function textsForSide(craft: Craft, terms: Terms, side: Side): Map<string, TextMatch> {
  const map = new Map<string, TextMatch>();
  for (const symbol of symbolsFor(craft)) {
    if (symbol.key === NO_STITCH) continue;
    const text = stitchText(symbol, craft, terms, side);
    map.set(text, { symbol, text });
  }
  if (craft === 'knit' && side === 'WS') {
    // k and p are valid on both sides; on a wrong-side row they place the opposite symbol.
    map.set('p', { symbol: findSymbol(craft, 'k')!, text: 'p' });
    map.set('k', { symbol: findSymbol(craft, 'p')!, text: 'k' });
  }
  return map;
}

/** Texts of the craft that belong to the other side, for the side error. */
export function textsForOtherSide(craft: Craft, side: Side): Set<string> {
  if (craft === 'crochet') return new Set();
  const other = new Set<string>();
  for (const symbol of KNIT_SYMBOLS) {
    if (symbol.key === NO_STITCH || symbol.key === CABLE) continue;
    if (symbol.key === 'k' || symbol.key === 'p' || symbol.key === 'yo') continue;
    other.add(side === 'WS' ? symbol.rsText : symbol.wsText);
  }
  return other;
}

/** Crochet texts of the other terms, for the terms error. */
export function textsForOtherTerms(craft: Craft, terms: Terms): Set<string> {
  if (craft !== 'crochet') return new Set();
  const other = new Set<string>();
  const inUse = new Set<string>();
  for (const symbol of CROCHET_SYMBOLS) {
    if (symbol.key === NO_STITCH) continue;
    inUse.add(terms === 'uk' ? symbol.wsText : symbol.rsText);
    other.add(terms === 'uk' ? symbol.rsText : symbol.wsText);
  }
  for (const text of inUse) other.delete(text);
  return other;
}
