export interface BodyModel {
  readonly code: string;
  readonly kind: 'body';
  readonly ratedLumens: number;
  readonly ratedHours: number;
  readonly nativeWidthPx: number;
  readonly nativeHeightPx: number;
  readonly watts: number;
}

export interface LensModel {
  readonly code: string;
  readonly kind: 'lens';
  readonly ratioMin: string;
  readonly ratioMax: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
}

export type UnitModel = BodyModel | LensModel;

export const FALLBACK_BODY_MODEL = 'VK-20';

export const MODELS: readonly UnitModel[] = [
  { code: 'VK-20', kind: 'body', ratedLumens: 20_000, ratedHours: 20_000, nativeWidthPx: 1920, nativeHeightPx: 1200, watts: 1900 },
  { code: 'VK-12', kind: 'body', ratedLumens: 12_000, ratedHours: 20_000, nativeWidthPx: 1920, nativeHeightPx: 1200, watts: 1200 },
  { code: 'LS-13', kind: 'lens', ratioMin: '1.2', ratioMax: '1.6', shiftAcrossPercent: '30', shiftDownPercent: '50' },
  { code: 'LS-20', kind: 'lens', ratioMin: '1.7', ratioMax: '2.4', shiftAcrossPercent: '20', shiftDownPercent: '40' },
];

export const CIRCUIT_CAPACITY_WATTS: Readonly<Record<string, number>> = {
  '230V-16A': 3680,
  '400V-CEE-16A': 11_085,
  '400V-CEE-32A': 22_170,
};

export const CIRCUIT_KINDS = Object.keys(CIRCUIT_CAPACITY_WATTS);

export const BANDS = {
  washedOut: 'Washed out',
  graphics: 'Reads as graphics',
  image: 'Reads as image',
  none: 'No reading',
} as const;

export type Band = (typeof BANDS)[keyof typeof BANDS];

/** The band of a cell, decided on the unrounded contrast. */
export function bandOf(contrast: number | null): Band {
  if (contrast === null) return BANDS.none;
  if (contrast < 3) return BANDS.washedOut;
  if (contrast < 5) return BANDS.graphics;
  return BANDS.image;
}

/** Effective output falls linearly to half at the rated hours and stays there. */
export function effectiveLumens(ratedLumens: number, ratedHours: number, loggedHours: number): number {
  const wear = Math.min(1, loggedHours / ratedHours);
  return ratedLumens * (1 - 0.5 * wear);
}
