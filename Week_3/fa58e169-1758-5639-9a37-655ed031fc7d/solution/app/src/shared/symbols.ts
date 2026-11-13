export type Craft = 'knit' | 'crochet'
export type Mode = 'flat' | 'round'
export type Terms = 'us' | 'uk'
export type Side = 'RS' | 'WS' | 'RND'

export interface Symbol {
  key: string
  name: string
  letter: string
  rsText: string
  wsText: string | null
  uses: number
  makes: number
  family: number
  /** a run of this stitch always prints its count: k4, sc6 */
  counted: boolean
  /** the stitch this one becomes when its selection is mirrored */
  mirror: string | null
}

/** The knit symbol table: the one place stitch keys, names, letters, texts and stitch counts are decided. */
export const KNIT_SYMBOLS: readonly Symbol[] = [
  { key: 'k', name: 'Knit', letter: 'k', rsText: 'k', wsText: 'p', uses: 1, makes: 1, family: 0, counted: true, mirror: null },
  { key: 'p', name: 'Purl', letter: 'p', rsText: 'p', wsText: 'k', uses: 1, makes: 1, family: 1, counted: true, mirror: null },
  { key: 'yo', name: 'Yarn over', letter: 'o', rsText: 'yo', wsText: 'yo', uses: 0, makes: 1, family: 2, counted: false, mirror: null },
  { key: 'k2tog', name: 'Knit two together', letter: 't', rsText: 'k2tog', wsText: 'p2tog', uses: 2, makes: 1, family: 3, counted: false, mirror: 'ssk' },
  { key: 'ssk', name: 'Slip slip knit', letter: 's', rsText: 'ssk', wsText: 'ssp', uses: 2, makes: 1, family: 4, counted: false, mirror: 'k2tog' },
  { key: 'cdd', name: 'Centred double decrease', letter: 'd', rsText: 'cdd', wsText: 'cdp', uses: 3, makes: 1, family: 5, counted: false, mirror: null },
  { key: 'm1l', name: 'Make one left', letter: 'l', rsText: 'm1l', wsText: 'm1lp', uses: 0, makes: 1, family: 6, counted: false, mirror: 'm1r' },
  { key: 'm1r', name: 'Make one right', letter: 'r', rsText: 'm1r', wsText: 'm1rp', uses: 0, makes: 1, family: 7, counted: false, mirror: 'm1l' },
  { key: 'ns', name: 'No stitch', letter: 'x', rsText: '', wsText: '', uses: 0, makes: 0, family: 8, counted: false, mirror: null },
  { key: 'c22', name: '2/2 cable', letter: 'c', rsText: '2/2 LC', wsText: null, uses: 1, makes: 1, family: 9, counted: false, mirror: null },
]

const CROCHET_BASE = [
  { key: 'sc', name: 'Single crochet', letter: 's', us: 'sc', uk: 'dc', uses: 1, makes: 1, family: 0 },
  { key: 'hdc', name: 'Half double crochet', letter: 'h', us: 'hdc', uk: 'htr', uses: 1, makes: 1, family: 1 },
  { key: 'dc', name: 'Double crochet', letter: 'd', us: 'dc', uk: 'tr', uses: 1, makes: 1, family: 2 },
  { key: 'inc', name: 'Increase', letter: 'i', us: 'inc', uk: 'inc', uses: 1, makes: 2, family: 3 },
  { key: 'dec', name: 'Decrease', letter: 'e', us: 'dec', uk: 'dec', uses: 2, makes: 1, family: 4 },
  { key: 'ns', name: 'No stitch', letter: 'x', us: '', uk: '', uses: 0, makes: 0, family: 8 },
] as const

export function crochetSymbols(terms: Terms): readonly Symbol[] {
  return CROCHET_BASE.map((s) => ({
    key: s.key, name: s.name, letter: s.letter, rsText: s[terms], wsText: s[terms],
    uses: s.uses, makes: s.makes, family: s.family, counted: s.key !== 'inc' && s.key !== 'dec' && s.key !== 'ns', mirror: null,
  }))
}

export const CABLE_KEY = 'c22'
export const CABLE_CELLS = 4

/** Right-side rows and rounds read from the highest column down; flat wrong-side rows read from column 1 up. */
export function readsLeftward(side: Side): boolean {
  return side !== 'WS'
}

export function symbolsFor(craft: Craft, terms: Terms | null): readonly Symbol[] {
  return craft === 'knit' ? KNIT_SYMBOLS : crochetSymbols(terms ?? 'us')
}

export function symbolByKey(craft: Craft, terms: Terms | null, key: string): Symbol | undefined {
  return symbolsFor(craft, terms).find((s) => s.key === key)
}

export function sideOf(mode: Mode, row: number): Side {
  if (mode === 'round') return 'RND'
  return row % 2 === 1 ? 'RS' : 'WS'
}

export function symbolText(symbol: Symbol, side: Side): string {
  return side === 'WS' ? (symbol.wsText ?? symbol.rsText) : symbol.rsText
}

/** The seven-row worked shaping chart of the sample pattern: rows by symbol key. */
const KNIT_ROW = Array.from({ length: 12 }, () => 'k').join(' ')

export const SAMPLE_ROWS: Record<string, string> = {
  '1': KNIT_ROW,
  '2': KNIT_ROW,
  '3': 'ns k k2tog k k k k k k ssk k ns',
  '4': 'ns k ssk k k k k k2tog k ns ns ns',
  '5': 'ns k k k k k k k k ns ns ns',
  '6': 'ns k k k k k k k k ns ns ns',
  '7': 'ns k m1r k k k k k k m1l k ns',
}

export const COLOUR_LETTERS = 'ABCDEF'

interface ChartKind {
  label: string
  craft: Craft
  mode: Mode
  terms: Terms | null
  colourNames: readonly string[]
}

export const CHART_KINDS: readonly ChartKind[] = [
  { label: 'Flat knitting', craft: 'knit', mode: 'flat', terms: null, colourNames: ['Main'] },
  { label: 'Knitting in the round', craft: 'knit', mode: 'round', terms: null, colourNames: ['Main'] },
  { label: 'Stranded in the round', craft: 'knit', mode: 'round', terms: null, colourNames: ['Main', 'Contrast'] },
  { label: 'Crochet rows in US terms', craft: 'crochet', mode: 'flat', terms: 'us', colourNames: ['Main'] },
  { label: 'Crochet rows in UK terms', craft: 'crochet', mode: 'flat', terms: 'uk', colourNames: ['Main'] },
  { label: 'Tapestry crochet', craft: 'crochet', mode: 'flat', terms: 'us', colourNames: ['Main', 'Contrast'] },
]

export const DEFAULT_YARNS: Record<string, string> = { Main: '#f1ede4', Contrast: '#3d5a80' }
