export const COLOUR_HEX: Record<string, number> = {
  'pearl white': 0xeef1f2,
  'carbon black': 0x1d2022,
  graphite: 0x44484c,
  'sky blue': 0x6fb3e0,
  teal: 0x2b9c9c,
  'deep teal': 0x14666b,
  coral: 0xe2735c,
  'brushed silver': 0xbfc5c9,
  black: 0x1b1e20,
  'dark grey': 0x4a4f54,
  'light grey': 0xa9b0b5,
  yellow: 0xe9c23c,
  orange: 0xe2873c,
  green: 0x3f9c63,
  white: 0xf4f6f7,
};

export function hexOf(colour: string): number {
  return COLOUR_HEX[colour] ?? 0x8c9397;
}

export function cssOf(colour: string): string {
  return `#${hexOf(colour).toString(16).padStart(6, '0')}`;
}
