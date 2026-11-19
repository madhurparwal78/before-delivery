export interface Swatch {
  family: string;
  name: string;
  hex: string;
  onWhite: string;
  onWhiteRating: string;
  onInk: string;
  onInkRating: string;
}

/** The published swatch table of the colour chapter. */
export const SWATCHES: Swatch[] = [
  { family: 'Ember', name: 'Ember 700', hex: 'A3341F', onWhite: '6.84:1', onWhiteRating: 'AA', onInk: '2.63:1', onInkRating: 'Fail' },
  { family: 'Ember', name: 'Ember 300', hex: 'F2A08C', onWhite: '2.06:1', onWhiteRating: 'Fail', onInk: '8.72:1', onInkRating: 'AAA' },
  { family: 'Saffron', name: 'Saffron 700', hex: '9A5B00', onWhite: '5.43:1', onWhiteRating: 'AA', onInk: '3.31:1', onInkRating: 'AA Large' },
  { family: 'Saffron', name: 'Saffron 300', hex: 'F7C266', onWhite: '1.63:1', onWhiteRating: 'Fail', onInk: '11.01:1', onInkRating: 'AAA' },
  { family: 'Meadow', name: 'Meadow 700', hex: '2F6B2A', onWhite: '6.45:1', onWhiteRating: 'AA', onInk: '2.79:1', onInkRating: 'Fail' },
  { family: 'Meadow', name: 'Meadow 300', hex: 'A9D99A', onWhite: '1.61:1', onWhiteRating: 'Fail', onInk: '11.20:1', onInkRating: 'AAA' },
  { family: 'Lagoon', name: 'Lagoon 700', hex: '00666B', onWhite: '6.75:1', onWhiteRating: 'AA', onInk: '2.67:1', onInkRating: 'Fail' },
  { family: 'Lagoon', name: 'Lagoon 300', hex: '7FD3D0', onWhite: '1.73:1', onWhiteRating: 'Fail', onInk: '10.39:1', onInkRating: 'AAA' },
  { family: 'Harbour', name: 'Harbour 700', hex: '1F4E8C', onWhite: '8.31:1', onWhiteRating: 'AAA', onInk: '2.16:1', onInkRating: 'Fail' },
  { family: 'Harbour', name: 'Harbour 300', hex: '9DBDF0', onWhite: '1.91:1', onWhiteRating: 'Fail', onInk: '9.39:1', onInkRating: 'AAA' },
  { family: 'Iris', name: 'Iris 700', hex: '5B3A9E', onWhite: '8.26:1', onWhiteRating: 'AAA', onInk: '2.18:1', onInkRating: 'Fail' },
  { family: 'Iris', name: 'Iris 300', hex: 'C6B2F0', onWhite: '1.90:1', onWhiteRating: 'Fail', onInk: '9.44:1', onInkRating: 'AAA' },
  { family: 'Orchid', name: 'Orchid 700', hex: '8E2C77', onWhite: '7.56:1', onWhiteRating: 'AAA', onInk: '2.38:1', onInkRating: 'Fail' },
  { family: 'Orchid', name: 'Orchid 300', hex: 'EDA8DC', onWhite: '1.87:1', onWhiteRating: 'Fail', onInk: '9.62:1', onInkRating: 'AAA' },
  { family: 'Clay', name: 'Clay 700', hex: '7A4A33', onWhite: '7.36:1', onWhiteRating: 'AAA', onInk: '2.44:1', onInkRating: 'Fail' },
  { family: 'Clay', name: 'Clay 300', hex: 'E0B9A0', onWhite: '1.81:1', onWhiteRating: 'Fail', onInk: '9.95:1', onInkRating: 'AAA' },
  { family: 'Moss', name: 'Moss 700', hex: '4F5A1E', onWhite: '7.46:1', onWhiteRating: 'AAA', onInk: '2.41:1', onInkRating: 'Fail' },
  { family: 'Moss', name: 'Moss 300', hex: 'CFD88E', onWhite: '1.51:1', onWhiteRating: 'Fail', onInk: '11.87:1', onInkRating: 'AAA' },
  { family: 'Stone', name: 'Stone 700', hex: '4D4A55', onWhite: '8.66:1', onWhiteRating: 'AAA', onInk: '2.08:1', onInkRating: 'Fail' },
  { family: 'Stone', name: 'Stone 300', hex: 'C9C6CF', onWhite: '1.69:1', onWhiteRating: 'Fail', onInk: '10.67:1', onInkRating: 'AAA' },
];

/** Clockwise from the top of the palette wheel. */
export const FAMILY_ORDER = [
  'Ember',
  'Saffron',
  'Meadow',
  'Lagoon',
  'Harbour',
  'Iris',
  'Orchid',
  'Clay',
  'Moss',
  'Stone',
];
