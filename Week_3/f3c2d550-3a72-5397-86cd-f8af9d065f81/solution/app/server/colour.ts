export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

const DISPLAY_P3_TO_SRGB: readonly (readonly [number, number, number])[] = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

const linearise = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const encode = (value: number): number => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Converts a Display P3 colour (channels 0 to 255, unrounded) to whole-number screen colour. */
function displayP3ToSrgb({ red, green, blue }: Rgb): Rgb {
  const linear = [red, green, blue].map((channel) => linearise(channel / 255));
  const [r = 0, g = 0, b = 0] = DISPLAY_P3_TO_SRGB.map((row) =>
    Math.round(encode(clamp01(row.reduce((sum, weight, index) => sum + weight * (linear[index] ?? 0), 0))) * 255),
  );
  return { red: r, green: g, blue: b };
}

/** The stored screen colour for a mean over pixel values as stored (unrounded). */
export function screenColour(mean: Rgb, displayP3: boolean): Rgb {
  if (displayP3) return displayP3ToSrgb(mean);
  return { red: Math.round(mean.red), green: Math.round(mean.green), blue: Math.round(mean.blue) };
}

export function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export const BLACK: Rgb = { red: 0, green: 0, blue: 0 };
