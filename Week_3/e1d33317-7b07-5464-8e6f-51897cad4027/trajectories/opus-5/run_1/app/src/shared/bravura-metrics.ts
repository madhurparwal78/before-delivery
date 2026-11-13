// Bravura glyph metrics, in staff spaces, taken from the Bravura SMuFL metadata (OFL-1.1).
export interface GlyphMetric {
  readonly codepoint: string;
  readonly advance: number;
  readonly bBoxNE: readonly [number, number];
  readonly bBoxSW: readonly [number, number];
}

export const BRAVURA_GLYPHS = {
  gClef: { codepoint: '\u{e050}', advance: 2.684, bBoxNE: [2.684, 4.392], bBoxSW: [0.0, -2.632] },
  cClef: { codepoint: '\u{e05c}', advance: 2.796, bBoxNE: [2.796, 2.024], bBoxSW: [0.0, -2.024] },
  fClef: { codepoint: '\u{e062}', advance: 2.736, bBoxNE: [2.736, 1.048], bBoxSW: [-0.02, -2.54] },
  unpitchedPercussionClef1: { codepoint: '\u{e069}', advance: 1.528, bBoxNE: [1.528, 1.0], bBoxSW: [0.0, -1.0] },
  noteheadWhole: { codepoint: '\u{e0a2}', advance: 1.688, bBoxNE: [1.688, 0.5], bBoxSW: [0.0, -0.5] },
  noteheadHalf: { codepoint: '\u{e0a3}', advance: 1.18, bBoxNE: [1.18, 0.5], bBoxSW: [0.0, -0.5] },
  noteheadBlack: { codepoint: '\u{e0a4}', advance: 1.18, bBoxNE: [1.18, 0.5], bBoxSW: [0.0, -0.5] },
  flag8thUp: { codepoint: '\u{e240}', advance: 1.056, bBoxNE: [1.056, 0.03521239682756091], bBoxSW: [0.0, -3.240768470618394] },
  flag8thDown: { codepoint: '\u{e241}', advance: 1.224, bBoxNE: [1.224, 3.232896633157715], bBoxSW: [0.0, -0.0575672] },
  flag16thUp: { codepoint: '\u{e242}', advance: 1.116, bBoxNE: [1.116, 0.008], bBoxSW: [0.0, -3.252] },
  flag16thDown: { codepoint: '\u{e243}', advance: 1.168, bBoxNE: [1.1635806326044895, 3.2480256], bBoxSW: [-1.9418183745617774e-05, -0.03601094374150052] },
  flag32ndUp: { codepoint: '\u{e244}', advance: 1.048, bBoxNE: [1.044, 0.596], bBoxSW: [0.0, -3.248] },
  flag32ndDown: { codepoint: '\u{e245}', advance: 1.096, bBoxNE: [1.092, 3.248], bBoxSW: [0.0, -0.687477099907407] },
  restWhole: { codepoint: '\u{e4e3}', advance: 1.132, bBoxNE: [1.128, 0.036], bBoxSW: [0.0, -0.54] },
  restHalf: { codepoint: '\u{e4e4}', advance: 1.132, bBoxNE: [1.128, 0.568], bBoxSW: [0.0, -0.008] },
  restQuarter: { codepoint: '\u{e4e5}', advance: 1.08, bBoxNE: [1.08, 1.492], bBoxSW: [0.004, -1.5] },
  rest8th: { codepoint: '\u{e4e6}', advance: 1.0, bBoxNE: [0.988, 0.696], bBoxSW: [0.0, -1.004] },
  rest16th: { codepoint: '\u{e4e7}', advance: 1.28, bBoxNE: [1.28, 0.716], bBoxSW: [0.0, -2.0] },
  rest32nd: { codepoint: '\u{e4e8}', advance: 1.452, bBoxNE: [1.452, 1.704], bBoxSW: [0.0, -2.0] },
  accidentalFlat: { codepoint: '\u{e260}', advance: 0.904, bBoxNE: [0.904, 1.756], bBoxSW: [0.0, -0.7] },
  accidentalNatural: { codepoint: '\u{e261}', advance: 0.672, bBoxNE: [0.672, 1.364], bBoxSW: [0.0, -1.34] },
  accidentalSharp: { codepoint: '\u{e262}', advance: 0.996, bBoxNE: [0.996, 1.4], bBoxSW: [0.0, -1.392] },
  accidentalDoubleSharp: { codepoint: '\u{e263}', advance: 1.0, bBoxNE: [0.988, 0.508], bBoxSW: [0.0, -0.5] },
  accidentalDoubleFlat: { codepoint: '\u{e264}', advance: 1.652, bBoxNE: [1.644, 1.748], bBoxSW: [0.0, -0.7] },
  augmentationDot: { codepoint: '\u{e1e7}', advance: 0.4, bBoxNE: [0.4, 0.2], bBoxSW: [0.0, -0.2] },
  timeSig0: { codepoint: '\u{e080}', advance: 1.88, bBoxNE: [1.8, 1.004], bBoxSW: [0.08, -1.0] },
  timeSig1: { codepoint: '\u{e081}', advance: 1.336, bBoxNE: [1.256, 1.004], bBoxSW: [0.08, -1.0] },
  timeSig2: { codepoint: '\u{e082}', advance: 1.784, bBoxNE: [1.704, 1.016], bBoxSW: [0.08, -1.028] },
  timeSig3: { codepoint: '\u{e083}', advance: 1.684, bBoxNE: [1.604, 0.996], bBoxSW: [0.08, -1.004] },
  timeSig4: { codepoint: '\u{e084}', advance: 1.88, bBoxNE: [1.8, 1.004], bBoxSW: [0.08, -1.0] },
  timeSig5: { codepoint: '\u{e085}', advance: 1.612, bBoxNE: [1.532, 0.984], bBoxSW: [0.08, -1.004] },
  timeSig6: { codepoint: '\u{e086}', advance: 1.736, bBoxNE: [1.656, 1.004], bBoxSW: [0.08, -0.996] },
  timeSig7: { codepoint: '\u{e087}', advance: 1.764, bBoxNE: [1.684, 0.996], bBoxSW: [0.08, -1.0] },
  timeSig8: { codepoint: '\u{e088}', advance: 1.744, bBoxNE: [1.664, 1.036], bBoxSW: [0.08, -1.036] },
  timeSig9: { codepoint: '\u{e089}', advance: 1.736, bBoxNE: [1.656, 1.004], bBoxSW: [0.08, -0.996] },
  dynamicPiano: { codepoint: '\u{e520}', advance: 1.46, bBoxNE: [1.464, 1.096], bBoxSW: [-0.356, -0.568] },
  dynamicMezzo: { codepoint: '\u{e521}', advance: 1.748, bBoxNE: [1.784, 1.096], bBoxSW: [-0.08, -0.04] },
  dynamicForte: { codepoint: '\u{e522}', advance: 1.456, bBoxNE: [1.456, 1.776], bBoxSW: [-0.564, -0.608] },
  dynamicRinforzando: { codepoint: '\u{e523}', advance: 1.108, bBoxNE: [1.108, 1.096], bBoxSW: [-0.08, 0.0] },
  dynamicSforzando: { codepoint: '\u{e524}', advance: 0.916, bBoxNE: [0.916, 1.092], bBoxSW: [0.0, -0.04] },
  dynamicZ: { codepoint: '\u{e525}', advance: 0.976, bBoxNE: [0.976, 1.072], bBoxSW: [-0.12, -0.04] },
  dynamicNiente: { codepoint: '\u{e526}', advance: 1.232, bBoxNE: [1.232, 1.096], bBoxSW: [-0.092, -0.04] },
} as const satisfies Record<string, GlyphMetric>;

export type GlyphName = keyof typeof BRAVURA_GLYPHS;

export const ENGRAVING_DEFAULTS = {
  staffLineThickness: 0.13,
  stemThickness: 0.12,
  thinBarlineThickness: 0.16,
  thickBarlineThickness: 0.5,
  legerLineThickness: 0.16,
  legerLineExtension: 0.4,
  tieEndpointThickness: 0.1,
  tieMidpointThickness: 0.22,
  barlineSeparation: 0.4,
} as const;
