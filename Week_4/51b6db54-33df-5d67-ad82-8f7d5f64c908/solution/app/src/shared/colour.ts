export type Rgba = readonly [number, number, number, number];

const HEX8 = /^[0-9a-f]{8}$/;

export const isColour = (value: unknown): value is string => typeof value === 'string' && HEX8.test(value);

export function parseColour(text: string): Rgba {
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
    parseInt(text.slice(6, 8), 16),
  ];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

export function colourText(r: number, g: number, b: number, a: number): string {
  return hex2(r) + hex2(g) + hex2(b) + hex2(a);
}
