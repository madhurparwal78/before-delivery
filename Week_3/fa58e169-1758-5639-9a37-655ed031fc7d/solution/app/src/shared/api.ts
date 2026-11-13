import type { Craft, Mode, Side, Terms } from './symbols.ts'

export type RowState = 'ok' | 'error' | 'empty'

export interface Colour { letter: string; name: string; hex: string }
export interface Repeat { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }
export interface Cell { row: number; col: number; stitch: string; colour: string; repeat: string; rev: number }

/** A piece of a written line. Pieces with `cols` are tokens: the chart columns (in reading order) they were worked from. */
export interface Segment { text: string; cols?: number[] }

export interface Row {
  row: number
  side: Side
  used: number
  made: number
  state: RowState
  errors: string[]
  text: string
  notes: number
  segments: Segment[]
  textBlock: string | null
}

export type PublicRow = Omit<Row, 'notes' | 'textBlock'>

export interface ColourWarning { row: number; message: string }

export interface Limits {
  maxChartRows: number; maxChartCols: number; maxColours: number; coloursPerRow: number; maxFloat: number
  undoDepth: number; noteMaxChars: number; editsPerMinute: number; sheetLinesPerPage: number; noticeSeconds: number
  rowMotionMs: number; presenceTtlSeconds: number; inviteTtlHours: number; verifyTtlHours: number
}

export interface Config { today: string; timeZone: string; limits: Limits }

export interface ChartShape {
  craft: Craft; mode: Mode; terms: Terms | null
  castOn: number; width: number; height: number
  colours: Colour[]; repeats: Repeat[]; cells: Cell[]; rows: Row[]
}

export type VersionPayload = Omit<ChartShape, 'craft' | 'mode' | 'terms'> & { version: number; note: string; savedOn: string }

export type Role = 'owner' | 'co-designer' | 'tester'

export interface TesterEntry { id: string; name: string; version: number; row: number; notes: number }

export interface DesignerPattern extends ChartShape {
  id: string; name: string; version: number; state: 'draft' | 'published'
  colourWarnings: ColourWarning[]; role: Role; testers: TesterEntry[]
}

export interface FollowPattern extends ChartShape {
  id: string; name: string; version: number; latestVersion: number; row: number
}

export interface PublicPattern extends Omit<ChartShape, 'rows'> { id: string; name: string; version: number; rows: PublicRow[] }

export interface VersionEntry { version: number; note: string; savedOn: string; stitches: number }

export interface NoteEntry { row: number; text: string; tester: string; version: number }

export interface ApiError { error: string; message?: string; field?: string; position?: number | null }

export interface Conflict { row: number; col: number; by: string; stitch: string; colour: string; rev: number }

export interface EditResult {
  applied: { row: number; col: number; rev: number }[]
  conflicts: Conflict[]
  rows: Row[]
  colourWarnings: ColourWarning[]
}

export interface MirrorResult {
  applied: { row: number; col: number; stitch: string; colour: string; rev: number }[]
  conflicts: Conflict[]
  rows: Row[]
  colourWarnings: ColourWarning[]
}

export interface TextResult {
  changed: number
  cells: { row: number; col: number; stitch: string; colour: string; rev: number }[]
  rows: Row[]
  colourWarnings: ColourWarning[]
}

/** Full chart replacement: boxes, expansions and restores send every cell. */
export interface Structure {
  width: number; height: number; castOn: number
  colours: Colour[]; repeats: Repeat[]; cells: Cell[]; rows: Row[]; colourWarnings: ColourWarning[]
}

export interface PersonRef { id: string; name: string }

/** Live messages, server to browser. */
export type LiveMessage =
  | { type: 'hello'; live: boolean; users: PersonRef[] }
  | { type: 'live'; live: boolean }
  | { type: 'presence'; users: PersonRef[] }
  | { type: 'cursor'; user: PersonRef; row: number; col: number }
  | { type: 'edit'; by: PersonRef; op: string | null; cells: { row: number; col: number; stitch: string; colour: string; rev: number }[]; rows: Row[]; colourWarnings: ColourWarning[] }
  | { type: 'structure'; by: PersonRef; op: string | null; restored: boolean; structure: Structure }
  | { type: 'times'; by: PersonRef; op: string | null; rows: Row[]; repeats: Repeat[]; colourWarnings: ColourWarning[] }
  | { type: 'colours'; op: string | null; colours: Colour[] }
  | { type: 'versions'; entry: VersionEntry; latest: number }
  | { type: 'counter'; user: PersonRef; version: number; row: number }
  | { type: 'followed'; user: PersonRef; version: number; row: number; movedFrom: number | null }
  | { type: 'note'; user: PersonRef; row: number; text: string; version: number; rowNotes: number; testerNotes: number; ownRowNotes: number }
  | { type: 'tester'; tester: TesterEntry }
