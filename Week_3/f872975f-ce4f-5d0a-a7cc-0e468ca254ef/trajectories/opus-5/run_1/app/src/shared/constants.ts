export const SPECIES = ['Black walnut', 'Chestnut', 'Douglas fir', 'Heart pine', 'White oak'] as const;
export const GRADES = ['Select', 'Character', 'Rustic'] as const;
export const DEFECT_KINDS = ['nail hole', 'check', 'bolt hole'] as const;

export type Species = (typeof SPECIES)[number];
export type Grade = (typeof GRADES)[number];
export type DefectKind = (typeof DEFECT_KINDS)[number];

/** Saw kerf in millimetres. */
export const KERF_MM = 3.2;
/** The kerf rounded up to whole millimetres, as used for the offcut and the ledger. */
export const KERF_WHOLE_MM = Math.ceil(KERF_MM);
/** The smallest offcut worth keeping; below this a sale takes the whole board. */
export const MIN_OFFCUT_MM = 300;
/** The least gap allowed between two pieces. */
export const MIN_PIECE_GAP_MM = 10;
/** The fixed deposit in cents. */
export const DEPOSIT_CENTS = 2500;
/** Cubic millimetres in a board foot, scaled by 1000 to stay an integer. */
export const MM3_PER_BOARD_FOOT_X1000 = 2_359_737_216n;
/** Grade tally strokes drawn on a rack strip. */
export const GRADE_STROKES: Record<Grade, number> = { Select: 1, Character: 2, Rustic: 3 };

export const MAX_PIECES = 20;
export const MAX_DEFECT_ZONES = 50;
export const MAX_PHOTOS_PER_BOARD = 8;
export const MAX_PHOTO_PIXELS = 40_000_000;
export const MAX_JSON_BYTES = 65_536;
export const MAX_PHOTO_BYTES = 5_000_000;

export const DECLINED_CARD_DIGITS = '4000000000000002';
