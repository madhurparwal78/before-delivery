import type { Phase } from './types.js';

/** The one definition of the colour roles; the stylesheet reads them as custom properties. */
export const PALETTE = {
  bone: '#F4EDE2',
  surface: '#E7DCCB',
  ink: '#1A1310',
  muted: '#6A594A',
  slate: '#39556F',
  postRed: '#B32B1A',
  mustard: '#E8AE26',
  maroon: '#6B1A18',
  white: '#FFFFFF',
} as const;

export const CSS_VARIABLE_NAMES: Record<keyof typeof PALETTE, string> = {
  bone: '--bone',
  surface: '--surface',
  ink: '--ink',
  muted: '--muted',
  slate: '--slate',
  postRed: '--post-red',
  mustard: '--mustard',
  maroon: '--maroon',
  white: '--white',
};

export interface FieldColours {
  field: string;
  text: string;
}

export const PHASE_FIELD: Record<Phase, FieldColours> = {
  open_up: { field: PALETTE.postRed, text: PALETTE.white },
  take_out: { field: PALETTE.bone, text: PALETTE.ink },
  fit_new: { field: PALETTE.mustard, text: PALETTE.ink },
  close_up: { field: PALETTE.slate, text: PALETTE.white },
  test_it: { field: PALETTE.maroon, text: PALETTE.white },
};

export const CLOSING_TOTAL_FIELD: FieldColours = {
  field: PALETTE.postRed,
  text: PALETTE.white,
};

export function paletteCssVariables(): string {
  return Object.entries(PALETTE)
    .map(([key, value]) => `${CSS_VARIABLE_NAMES[key as keyof typeof PALETTE]}:${value};`)
    .join('');
}
