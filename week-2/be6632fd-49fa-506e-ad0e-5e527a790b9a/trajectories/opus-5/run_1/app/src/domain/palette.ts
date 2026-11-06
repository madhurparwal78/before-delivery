/** The eight named swatches a drop palette draws from. */
const SWATCHES: Record<string, string> = {
  stone: '#e8e3da',
  ink: '#16161a',
  vermilion: '#c2411f',
  night: '#101726',
  moss: '#3f4a2a',
  sand: '#d8c49a',
  rust: '#9b4a21',
  fog: '#c4c9cd',
};

export const SWATCH_NAMES = Object.keys(SWATCHES);

export function swatchColour(name: string): string {
  return SWATCHES[name] ?? (SWATCHES['stone'] as string);
}
