export type Craft = 'knit' | 'crochet';
export type Mode = 'flat' | 'round';
export type Terms = 'us' | 'uk' | null;
export type Side = 'RS' | 'WS' | 'RND';
export type CountState = 'ok' | 'error' | 'empty';

export interface CellRef {
  row: number;
  col: number;
}

export interface Cell extends CellRef {
  stitch: string;
  colour: string;
  repeat: string | null;
  rev: number;
}

export interface RepeatBox {
  id: string;
  fromCol: number;
  toCol: number;
  fromRow: number;
  toRow: number;
  times: number;
}

export interface ColourDef {
  letter: string;
  name: string;
  hex: string;
}

export interface Chart {
  craft: Craft;
  mode: Mode;
  terms: Terms;
  castOn: number;
  width: number;
  height: number;
  colours: ColourDef[];
  repeats: RepeatBox[];
  cells: Cell[];
}

/** One worked stitch item of a row: a single stitch, or one four-cell cable. */
export interface RowItem {
  stitch: string;
  text: string;
  counted: boolean;
  uses: number;
  makes: number;
  colour: string;
  cells: CellRef[];
}

/** One printed run or item of a written line, with the chart cells it came from. */
export interface LineToken {
  text: string;
  cells: CellRef[];
}

export interface RowAnalysis {
  row: number;
  side: Side;
  used: number;
  made: number;
  needed: number;
  state: CountState;
  errors: string[];
  text: string;
  tokens: LineToken[];
  items: RowItem[];
}

export interface ColourWarning {
  row: number;
  message: string;
}

export interface ColourLimits {
  coloursPerRow: number;
  maxFloat: number;
}

export interface ChartAnalysis {
  rows: RowAnalysis[];
  colourWarnings: ColourWarning[];
}
