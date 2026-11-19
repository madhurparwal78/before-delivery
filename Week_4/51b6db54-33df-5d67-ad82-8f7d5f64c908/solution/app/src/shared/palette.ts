import { colourText, parseColour } from './colour';
import { rh } from './rules';

/** Step i of n between swatches a and b: each channel rh(a*(n-1-i) + b*i, n-1), alpha included. */
export function rampColours(from: string, to: string, steps: number): string[] {
  const a = parseColour(from);
  const b = parseColour(to);
  return Array.from({ length: steps }, (_, i) => {
    const channel = (k: number): number => rh((a[k] ?? 0) * (steps - 1 - i) + (b[k] ?? 0) * i, steps - 1);
    return colourText(channel(0), channel(1), channel(2), channel(3));
  });
}

export type PaletteFileResult = { colours: string[] } | { error: string };

const HEX6 = /^[0-9a-fA-F]{6}$/;
const BYTE = /^\d{1,3}$/;

/** Parses a .hex or .gpl palette file whole, or names the first bad line. */
export function parsePaletteFile(fileName: string, text: string): PaletteFileResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const colours: string[] = [];
  if (/\.hex$/i.test(fileName)) {
    for (const [i, line] of lines.entries()) {
      const value = line.trim();
      if (value === '') continue;
      if (!HEX6.test(value)) return { error: `Line ${i + 1}: expected six hex digits` };
      colours.push(`${value.toLowerCase()}ff`);
    }
    return { colours };
  }
  if (!/\.gpl$/i.test(fileName)) return { error: 'Use a .hex or .gpl file' };
  for (const [i, line] of lines.entries()) {
    const value = line.trim();
    if (i === 0 || value === '' || value.startsWith('#') || /^(Name|Columns):/.test(value)) continue;
    const [r, g, b] = value.split(/\s+/);
    if (![r, g, b].every((part) => part !== undefined && BYTE.test(part) && Number(part) <= 255)) {
      return { error: `Line ${i + 1}: expected three numbers from 0 to 255` };
    }
    colours.push(colourText(Number(r), Number(g), Number(b), 255));
  }
  return { colours };
}
