export type Rgb = [number, number, number];

const byte = (rgb: Rgb): Rgb => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];

/** The route teal, used for nothing but the ribbon. */
export const ROUTE_TEAL: Rgb = [31, 127, 122];

export const palette = {
  paper: [250, 246, 239] as Rgb,
  ink: [34, 26, 60] as Rgb,
  pink: [255, 77, 125] as Rgb,
  sun: [255, 194, 74] as Rgb,
  routeTeal: ROUTE_TEAL,
  grassLight: [140, 178, 99] as Rgb,
  grassDark: [111, 154, 78] as Rgb,
  ochre: [200, 160, 90] as Rgb,
  ochreLight: [217, 184, 120] as Rgb,
  skyHigh: [233, 240, 246] as Rgb,
  skyWarm: [255, 229, 178] as Rgb,
  parcelPaper: [182, 140, 94] as Rgb,
};

export const gl3 = (rgb: Rgb): Rgb => byte(rgb);
export const css = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const SATCHEL_COLOURS: Record<string, Rgb> = {
  canvas: [226, 213, 186],
  'riso-pink': [255, 79, 126],
  sunpatch: [255, 201, 74],
  'night-ink': [43, 34, 80],
  tidewater: [95, 182, 201],
};

export function satchelRgb(colour: string): Rgb {
  return SATCHEL_COLOURS[colour] ?? SATCHEL_COLOURS.canvas!;
}
