// SMuFL code points and Bravura metrics used by the engraver. Every metric is in staff spaces and is
// copied from Bravura's bravura_metadata.json (glyphBBoxes, glyphsWithAnchors, engravingDefaults).
// The font is drawn at four staff spaces per em, so one glyph unit is one staff space.

import type { Clef, DurationName } from '../../shared/music.js'
import type { Dynamic } from '../../shared/voice.js'

export const INK = '#1b1a17'
export const MUTED = '#6f675c'
export const PAPER = '#f6f1e7'

export const NOTATION_FONT = 'Bravura'
export const TEXT_FONT = 'IBM Plex Sans, Bravura'
export const NUMBER_FONT = 'IBM Plex Mono'
export const DISPLAY_FONT = 'Fraunces'

export const STAFF_LINE = 0.15
export const STEM_THICKNESS = 0.13
export const BARLINE_THICKNESS = 0.17
export const THICK_BARLINE_THICKNESS = 0.5
export const THIN_THICK_SEPARATION = 0.4
export const LEDGER_THICKNESS = 0.18
export const LEDGER_EXTENSION = 0.4
export const BEAM_THICKNESS = 0.5
export const BEAM_PITCH = 0.75
export const TIE_THICKNESS = 0.22

const NOTEHEAD_WHOLE = 0xe0a2
const NOTEHEAD_HALF = 0xe0a3
const NOTEHEAD_BLACK = 0xe0a4
export const AUGMENTATION_DOT = 0xe1e7
export const NOTE_QUARTER_UP = 0xe1d5
export const TIME_SIG_0 = 0xe080

/** noteheadBlack and noteheadHalf: stemUpSE (1.18, 0.168) and stemDownNW (0, -0.168). */
export const STEM_UP_X = 1.18
export const STEM_ATTACH_Y = 0.168

const HEAD_WIDTH: Record<DurationName, number> = { whole: 1.688, half: 1.18, quarter: 1.18, eighth: 1.18, '16th': 1.18, '32nd': 1.18 }
const HEAD_CODE: Record<DurationName, number> = {
  whole: NOTEHEAD_WHOLE, half: NOTEHEAD_HALF, quarter: NOTEHEAD_BLACK, eighth: NOTEHEAD_BLACK, '16th': NOTEHEAD_BLACK, '32nd': NOTEHEAD_BLACK,
}
const REST_CODE: Record<DurationName, number> = { whole: 0xe4e3, half: 0xe4e4, quarter: 0xe4e5, eighth: 0xe4e6, '16th': 0xe4e7, '32nd': 0xe4e8 }
const REST_WIDTH: Record<DurationName, number> = { whole: 1.128, half: 1.128, quarter: 1.08, eighth: 0.988, '16th': 1.28, '32nd': 1.452 }
const FLAG_COUNT: Record<DurationName, number> = { whole: 0, half: 0, quarter: 0, eighth: 1, '16th': 2, '32nd': 3 }

/** Flag glyphs flag8thUp/Down, flag16thUp/Down and flag32ndUp/Down with their stemUpNW / stemDownSW anchor heights. */
const FLAG_UP: Record<number, { code: number; anchor: number }> = {
  1: { code: 0xe240, anchor: -0.04 }, 2: { code: 0xe242, anchor: -0.088 }, 3: { code: 0xe244, anchor: 0.376 },
}
const FLAG_DOWN: Record<number, { code: number; anchor: number }> = {
  1: { code: 0xe241, anchor: 0.132 }, 2: { code: 0xe243, anchor: 0.128 }, 3: { code: 0xe245, anchor: -0.448 },
}

/** Accidental glyphs flat, natural, sharp, double sharp, double flat and their advance widths (bounding box). */
const ACCIDENTAL_CODE: Record<number, number> = { [-2]: 0xe264, [-1]: 0xe260, 0: 0xe261, 1: 0xe262, 2: 0xe263 }
const ACCIDENTAL_WIDTH: Record<number, number> = { [-2]: 1.644, [-1]: 0.904, 0: 0.672, 1: 0.996, 2: 0.988 }

const DYNAMIC_PIANO = 0xe520
const DYNAMIC_MEZZO = 0xe521
const DYNAMIC_FORTE = 0xe522
const DYNAMIC_SFORZANDO = 0xe524
const DYNAMIC_Z = 0xe525
const DYNAMIC_CODES: Record<Dynamic, readonly number[]> = {
  pp: [DYNAMIC_PIANO, DYNAMIC_PIANO],
  p: [DYNAMIC_PIANO],
  mp: [DYNAMIC_MEZZO, DYNAMIC_PIANO],
  mf: [DYNAMIC_MEZZO, DYNAMIC_FORTE],
  f: [DYNAMIC_FORTE],
  ff: [DYNAMIC_FORTE, DYNAMIC_FORTE],
  sfz: [DYNAMIC_SFORZANDO, DYNAMIC_FORTE, DYNAMIC_Z],
  fp: [DYNAMIC_FORTE, DYNAMIC_PIANO],
}

/** gClef, fClef, cClef and unpitchedPercussionClef1: origin line counted in staff spaces below the top line. */
const CLEFS: Record<Clef, { code: number; line: number; width: number }> = {
  treble: { code: 0xe050, line: 3, width: 2.684 },
  bass: { code: 0xe062, line: 1, width: 2.736 },
  alto: { code: 0xe05c, line: 2, width: 2.796 },
  tenor: { code: 0xe05c, line: 1, width: 2.796 },
  percussion: { code: 0xe069, line: 2, width: 1.528 },
}

export const TIME_DIGIT_WIDTH = 1.8
export const DOT_ADVANCE = 0.55

export function glyphRef(codes: readonly number[]): string {
  return codes.map((code) => `&#x${code.toString(16).toUpperCase()};`).join('')
}

export const headWidth = (duration: DurationName): number => HEAD_WIDTH[duration]
export const headCode = (duration: DurationName): number => HEAD_CODE[duration]
export const restCode = (duration: DurationName): number => REST_CODE[duration]
export const restWidth = (duration: DurationName): number => REST_WIDTH[duration]
export const flagCount = (duration: DurationName): number => FLAG_COUNT[duration]
export const flagGlyph = (count: number, up: boolean): { code: number; anchor: number } => (up ? FLAG_UP : FLAG_DOWN)[count] ?? { code: 0xe240, anchor: 0 }
export const accidentalCode = (alter: number): number => ACCIDENTAL_CODE[alter] ?? ACCIDENTAL_CODE[0] ?? 0xe261
export const accidentalWidth = (alter: number): number => ACCIDENTAL_WIDTH[alter] ?? 0.9
export const dynamicCodes = (dynamic: Dynamic): readonly number[] => DYNAMIC_CODES[dynamic]
export const clefShape = (clef: Clef): { code: number; line: number; width: number } => CLEFS[clef]
