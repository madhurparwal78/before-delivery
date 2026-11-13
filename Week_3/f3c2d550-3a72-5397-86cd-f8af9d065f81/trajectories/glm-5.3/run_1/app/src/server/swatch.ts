// Swatch rule (Business rules): mean of red, green and blue over an area of the
// upright image, Display P3 converted to sRGB by the published matrix, alpha-0
// pixels left out.

export interface SwatchResult {
  swatch: string; // #rrggbb lowercase
}

export function p3ToSrgb(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lr = lin(r), lg = lin(g), lb = lin(b);
  const m = [
    [1.2249401, -0.2249404, 0],
    [-0.0420569, 1.0420571, 0],
    [-0.0196376, -0.0786361, 1.0982735],
  ];
  const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const out = m.map((row) => clamp(row[0] * lr + row[1] * lg + row[2] * lb));
  const enc = (l: number) => {
    const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    return Math.round(v * 255);
  };
  return [enc(out[0]), enc(out[1]), enc(out[2])];
}

export function swatchHex(r: number, g: number, b: number): string {
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
