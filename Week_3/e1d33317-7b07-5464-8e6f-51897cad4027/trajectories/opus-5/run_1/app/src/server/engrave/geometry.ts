import { BRAVURA_GLYPHS, type GlyphName } from '../../shared/bravura-metrics.js';
import { diatonicIndex } from '../../shared/music.js';
import type { Clef, DurationName, Pitch } from '../../shared/types.js';

export const PAGE_WIDTH = 864;
export const PAGE_HEIGHT = 1152;
export const PAGE_MARGIN = 72;
export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

export const STAFF_SPACE = 7;
export const PART_STAFF_SPACE = 8;

export const HEADROOM_SPACES = 4;
export const FOOTROOM_SPACES = 4;
export const STAFF_GAP_SPACES = 3.6;

/** The diatonic index of the middle staff line under each clef. */
const CLEF_MIDDLE: Record<Clef, number> = {
  treble: 34,
  percussion: 34,
  alto: 28,
  tenor: 26,
  bass: 23,
};

const CLEF_GLYPH: Record<Clef, GlyphName> = {
  treble: 'gClef',
  percussion: 'unpitchedPercussionClef1',
  alto: 'cClef',
  tenor: 'cClef',
  bass: 'fClef',
};

/** Staff steps from the top line, counted in half spaces downwards. */
export function stepsBelowTopLine(pitch: Pitch, clef: Clef): number {
  return CLEF_MIDDLE[clef] + 4 - diatonicIndex(pitch);
}

export function clefGlyph(clef: Clef): GlyphName {
  return CLEF_GLYPH[clef];
}

/** Where the clef glyph sits, in half spaces below the top line. */
export function clefAnchor(clef: Clef): number {
  switch (clef) {
    case 'treble':
      return 6;
    case 'bass':
      return 2;
    case 'alto':
      return 4;
    case 'tenor':
      return 2;
    case 'percussion':
      return 4;
  }
}

export const NOTEHEAD: Record<DurationName, GlyphName> = {
  whole: 'noteheadWhole',
  half: 'noteheadHalf',
  quarter: 'noteheadBlack',
  eighth: 'noteheadBlack',
  '16th': 'noteheadBlack',
  '32nd': 'noteheadBlack',
};

export const REST_GLYPH: Record<DurationName, GlyphName> = {
  whole: 'restWhole',
  half: 'restHalf',
  quarter: 'restQuarter',
  eighth: 'rest8th',
  '16th': 'rest16th',
  '32nd': 'rest32nd',
};

export const FLAG_UP: Partial<Record<DurationName, GlyphName>> = {
  eighth: 'flag8thUp',
  '16th': 'flag16thUp',
  '32nd': 'flag32ndUp',
};

export const FLAG_DOWN: Partial<Record<DurationName, GlyphName>> = {
  eighth: 'flag8thDown',
  '16th': 'flag16thDown',
  '32nd': 'flag32ndDown',
};

export const ACCIDENTAL_GLYPH: Record<number, GlyphName> = {
  [-2]: 'accidentalDoubleFlat',
  [-1]: 'accidentalFlat',
  1: 'accidentalSharp',
  2: 'accidentalDoubleSharp',
};

const DYNAMIC_LETTERS: Record<string, GlyphName> = {
  p: 'dynamicPiano',
  m: 'dynamicMezzo',
  f: 'dynamicForte',
  r: 'dynamicRinforzando',
  s: 'dynamicSforzando',
  z: 'dynamicZ',
  n: 'dynamicNiente',
};

export function dynamicGlyphs(mark: string): GlyphName[] {
  return [...mark].map((letter) => DYNAMIC_LETTERS[letter]!).filter(Boolean);
}

export function glyphText(name: GlyphName): string {
  return BRAVURA_GLYPHS[name].codepoint;
}

export function glyphAdvance(name: GlyphName): number {
  return BRAVURA_GLYPHS[name].advance;
}

export const TIME_SIG_DIGITS: GlyphName[] = [
  'timeSig0',
  'timeSig1',
  'timeSig2',
  'timeSig3',
  'timeSig4',
  'timeSig5',
  'timeSig6',
  'timeSig7',
  'timeSig8',
  'timeSig9',
];
