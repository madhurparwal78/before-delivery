/** The kraft-and-ink palette, matching the custom properties in styles.css. */
export const palette = {
  kraft: '#e4d7bf',
  kraftLight: '#f6eee0',
  ink: '#16120f',
  orange: '#9e3a14',
  green: '#16402b',
  brownGrey: '#5b5048',
} as const;

export const crateTones = {
  box: '#c9ab7b',
  boxSide: '#bb9a66',
  boxFront: '#c2a16f',
  inside: '#e8dcc4',
  slot: '#d6c49e',
  tape: '#d9c9a6',
  glass: '#cdd6d2',
  paper: '#d9cdb4',
  sack: '#c6b68f',
  metal: '#b9bdb8',
} as const;

export const topColours = {
  mine: palette.orange,
  taken: palette.ink,
  dropped: palette.brownGrey,
} as const;
