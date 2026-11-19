export type Rgba = [number, number, number, number];

const HEX8 = /^[0-9a-f]{8}$/;

export function isColourText(text: string): boolean {
  return HEX8.test(text);
}

export function parseColour(text: string): Rgba {
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
    parseInt(text.slice(6, 8), 16),
  ];
}

export function formatColour(rgba: Rgba): string {
  let out = '';
  for (const channel of rgba) out += channel.toString(16).padStart(2, '0');
  return out;
}
