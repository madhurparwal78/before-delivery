import type { Craft, Mode, Side, Terms } from "./types";

export interface StitchDef {
  key: string;
  name: string;
  letter: string;
  rsText: string;
  wsText: string;
  usText: string;
  ukText: string;
  uses: number;
  makes: number;
}

export interface SymbolView {
  /** the text printed for the item on a given row context */
  text: string;
  /** items always print with a count, even alone */
  counted: boolean;
  uses: number;
  makes: number;
}

export interface SymbolContext {
  craft: Craft;
  terms: Terms | null;
}

export const KNIT_SYMBOLS: StitchDef[] = [
  { key: "k", name: "Knit", letter: "k", rsText: "k", wsText: "p", usText: "k", ukText: "k", uses: 1, makes: 1 },
  { key: "p", name: "Purl", letter: "p", rsText: "p", wsText: "k", usText: "p", ukText: "p", uses: 1, makes: 1 },
  { key: "yo", name: "Yarn over", letter: "o", rsText: "yo", wsText: "yo", usText: "yo", ukText: "yo", uses: 0, makes: 1 },
  { key: "k2tog", name: "Knit two together", letter: "t", rsText: "k2tog", wsText: "p2tog", usText: "k2tog", ukText: "k2tog", uses: 2, makes: 1 },
  { key: "ssk", name: "Slip slip knit", letter: "s", rsText: "ssk", wsText: "ssp", usText: "ssk", ukText: "ssk", uses: 2, makes: 1 },
  { key: "cdd", name: "Centred double decrease", letter: "d", rsText: "cdd", wsText: "cdp", usText: "cdd", ukText: "cdd", uses: 3, makes: 1 },
  { key: "m1l", name: "Make one left", letter: "l", rsText: "m1l", wsText: "m1lp", usText: "m1l", ukText: "m1l", uses: 0, makes: 1 },
  { key: "m1r", name: "Make one right", letter: "r", rsText: "m1r", wsText: "m1rp", usText: "m1r", ukText: "m1r", uses: 0, makes: 1 },
  { key: "ns", name: "No stitch", letter: "x", rsText: "", wsText: "", usText: "", ukText: "", uses: 0, makes: 0 },
  { key: "c22", name: "2/2 cable", letter: "c", rsText: "2/2 LC", wsText: "2/2 LC", usText: "2/2 LC", ukText: "2/2 LC", uses: 1, makes: 1 },
];

export const CROCHET_SYMBOLS: StitchDef[] = [
  { key: "sc", name: "Single crochet", letter: "s", rsText: "sc", wsText: "sc", usText: "sc", ukText: "dc", uses: 1, makes: 1 },
  { key: "hdc", name: "Half double crochet", letter: "h", rsText: "hdc", wsText: "hdc", usText: "hdc", ukText: "htr", uses: 1, makes: 1 },
  { key: "dc", name: "Double crochet", letter: "d", rsText: "dc", wsText: "dc", usText: "dc", ukText: "tr", uses: 1, makes: 1 },
  { key: "inc", name: "Increase", letter: "i", rsText: "inc", wsText: "inc", usText: "inc", ukText: "inc", uses: 1, makes: 2 },
  { key: "dec", name: "Decrease", letter: "e", rsText: "dec", wsText: "dec", usText: "dec", ukText: "dec", uses: 2, makes: 1 },
  { key: "ns", name: "No stitch", letter: "x", rsText: "", wsText: "", usText: "", ukText: "", uses: 0, makes: 0 },
];

export const KNIT_LETTER_MAP: Record<string, string> = Object.fromEntries(
  KNIT_SYMBOLS.map((symbol) => [symbol.letter, symbol.key]),
);
export const CROCHET_LETTER_MAP: Record<string, string> = Object.fromEntries(
  CROCHET_SYMBOLS.map((symbol) => [symbol.letter, symbol.key]),
);

export function symbolsOf(craft: Craft): StitchDef[] {
  return craft === "knit" ? KNIT_SYMBOLS : CROCHET_SYMBOLS;
}

export function symbolByKey(craft: Craft, key: string): StitchDef | undefined {
  return symbolsOf(craft).find((symbol) => symbol.key === key);
}

export function symbolByName(craft: Craft, name: string): StitchDef | undefined {
  return symbolsOf(craft).find((symbol) => symbol.name === name);
}

/** The printed text of a symbol on a given side, honouring crochet terms. */
export function symbolText(def: StitchDef, ctx: SymbolContext, side: Side): string {
  if (ctx.craft === "crochet") return ctx.terms === "uk" ? def.ukText : def.usText;
  if (side === "WS") return def.wsText;
  return def.rsText;
}

/** The full item view: printed text plus arithmetic. */
export function symbolView(def: StitchDef, ctx: SymbolContext, side: Side): SymbolView {
  return {
    text: symbolText(def, ctx, side),
    counted: def.key === "k" || def.key === "p" || (ctx.craft === "crochet" && def.key !== "inc" && def.key !== "dec"),
    uses: def.uses,
    makes: def.makes,
  };
}

/** The chart symbol that a printed text means on a given side. */
export function symbolForText(text: string, ctx: SymbolContext, side: Side): StitchDef | undefined {
  const table = symbolsOf(ctx.craft);
  return table.find((def) => symbolText(def, ctx, side) === text);
}

/** Texts valid for the craft, mapped to the chart symbols they name on a side. */
export function textTable(ctx: SymbolContext, side: Side): Map<string, string> {
  const table = new Map<string, string>();
  for (const def of symbolsOf(ctx.craft)) {
    const text = symbolText(def, ctx, side);
    if (text !== "") table.set(text, def.key);
  }
  return table;
}

export const MIRROR_PARTNERS: Record<string, string> = {
  k2tog: "ssk",
  ssk: "k2tog",
  m1l: "m1r",
  m1r: "m1l",
};

export const CABLE_TEXT = "2/2 LC";
export const CABLE_KEY = "c22";
export const CABLE_CELLS = 4;

export interface ChartKind {
  label: string;
  craft: Craft;
  mode: Mode;
  terms: Terms | null;
  colours: { letter: string; name: string }[];
}

export const CHART_KINDS: ChartKind[] = [
  { label: "Flat knitting", craft: "knit", mode: "flat", terms: null, colours: [{ letter: "A", name: "Main" }] },
  { label: "Knitting in the round", craft: "knit", mode: "round", terms: null, colours: [{ letter: "A", name: "Main" }] },
  {
    label: "Stranded in the round",
    craft: "knit",
    mode: "round",
    terms: null,
    colours: [
      { letter: "A", name: "Main" },
      { letter: "B", name: "Contrast" },
    ],
  },
  { label: "Crochet rows in US terms", craft: "crochet", mode: "flat", terms: "us", colours: [{ letter: "A", name: "Main" }] },
  { label: "Crochet rows in UK terms", craft: "crochet", mode: "flat", terms: "uk", colours: [{ letter: "A", name: "Main" }] },
  {
    label: "Tapestry crochet",
    craft: "crochet",
    mode: "flat",
    terms: "us",
    colours: [
      { letter: "A", name: "Main" },
      { letter: "B", name: "Contrast" },
    ],
  },
];

export function chartKindByLabel(label: string): ChartKind | undefined {
  return CHART_KINDS.find((kind) => kind.label === label);
}

export function sideOfRow(mode: Mode, row: number): Side {
  if (mode === "round") return "RND";
  return row % 2 === 1 ? "RS" : "WS";
}
