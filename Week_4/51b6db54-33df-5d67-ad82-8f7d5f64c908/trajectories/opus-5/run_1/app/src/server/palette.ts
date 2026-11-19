import type { PoolClient } from 'pg';
import { formatColour, isColourText, parseColour } from '../shared/colour.js';
import { rh } from '../shared/composite.js';
import { unprocessable } from './errors.js';
import { config } from './config.js';
import { first } from './db.js';
import { swatchesOf, type SwatchRow } from './sprite.js';

export const TRANSPARENT_INDEX_TEXT = 'Index 0 is transparent';

export async function paletteOrder(client: PoolClient, paletteId: number): Promise<number[]> {
  const stored = await first<{ swatch_order: number[] }>(
    client,
    'SELECT swatch_order FROM palettes WHERE id = $1',
    [paletteId],
  );
  const present = (await swatchesOf(client, paletteId)).filter((swatch) => swatch.present);
  const indices = present.map((swatch) => swatch.index);
  const chosen = (stored?.swatch_order ?? []).filter((index) => indices.includes(index));
  for (const index of indices) if (!chosen.includes(index)) chosen.push(index);
  return chosen;
}

export async function nextFreeIndex(client: PoolClient, paletteId: number): Promise<number | null> {
  const taken = new Set(
    (await swatchesOf(client, paletteId)).filter((swatch) => swatch.present).map((swatch) => swatch.index),
  );
  for (let index = 1; index <= config.paletteMax; index += 1) if (!taken.has(index)) return index;
  return null;
}

/** New swatches take the lowest free index; a freed index keeps rising in version. */
export async function addSwatch(
  client: PoolClient,
  paletteId: number,
  colour: string,
  byUserId: number,
): Promise<{ index: number; color: string; version: number }> {
  const index = await nextFreeIndex(client, paletteId);
  if (index === null) throw unprocessable({ color: paletteLimitText() });
  const existing = await first<{ version: number }>(
    client,
    'SELECT version FROM swatches WHERE palette_id = $1 AND index = $2',
    [paletteId, index],
  );
  if (existing === null) {
    await client.query(
      'INSERT INTO swatches (palette_id, index, color, version, present, edited_by) VALUES ($1, $2, $3, 1, true, $4)',
      [paletteId, index, colour, byUserId],
    );
    return { index, color: colour, version: 1 };
  }
  const version = existing.version + 1;
  await client.query(
    `UPDATE swatches SET color = $3, version = $4, present = true, edited_by = $5, removed_by = NULL
      WHERE palette_id = $1 AND index = $2`,
    [paletteId, index, colour, version, byUserId],
  );
  return { index, color: colour, version };
}

export function paletteLimitText(): string {
  return `Palette limit is ${config.paletteMax} swatches`;
}

export function requireColourText(value: unknown, field = 'color'): string {
  const text = String(value ?? '');
  if (!isColourText(text)) throw unprocessable({ [field]: 'Use eight lowercase hex digits' });
  return text;
}

/** Step i of n between two colours, each channel rounded half up. */
export function rampColours(from: string, to: string, steps: number): string[] {
  const a = parseColour(from);
  const b = parseColour(to);
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    out.push(
      formatColour([
        rh(a[0] * (steps - 1 - i) + b[0] * i, steps - 1),
        rh(a[1] * (steps - 1 - i) + b[1] * i, steps - 1),
        rh(a[2] * (steps - 1 - i) + b[2] * i, steps - 1),
        rh(a[3] * (steps - 1 - i) + b[3] * i, steps - 1),
      ]),
    );
  }
  return out;
}

export interface ParsedPalette {
  colours: string[];
}

/** Hex and GIMP palette files, refused at their first bad line. */
export function parsePaletteFile(fileName: string, text: string): ParsedPalette {
  const lower = fileName.toLowerCase();
  const lines = text.split(/\r?\n/);
  if (lower.endsWith('.hex')) {
    const colours: string[] = [];
    lines.forEach((line, at) => {
      const value = line.trim();
      if (value === '') return;
      if (!/^[0-9a-fA-F]{6}$/.test(value)) {
        throw unprocessable({ file: `Line ${at + 1}: expected six hex digits` });
      }
      colours.push(`${value.toLowerCase()}ff`);
    });
    return { colours };
  }
  if (!lower.endsWith('.gpl')) throw unprocessable({ file: 'Use a .hex or .gpl file' });

  const colours: string[] = [];
  let seenHeader = false;
  lines.forEach((line, at) => {
    const value = line.trim();
    if (!seenHeader) {
      if (value === '') return;
      if (value !== 'GIMP Palette') {
        throw unprocessable({ file: `Line ${at + 1}: expected GIMP Palette` });
      }
      seenHeader = true;
      return;
    }
    if (value === '' || value.startsWith('#')) return;
    if (/^(Name|Columns):/i.test(value)) return;
    const parts = value.split(/\s+/);
    const channels = parts.slice(0, 3).map((part) => Number(part));
    const valid =
      parts.length >= 3 &&
      channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255);
    if (!valid) {
      throw unprocessable({ file: `Line ${at + 1}: expected three numbers from 0 to 255` });
    }
    colours.push(formatColour([channels[0], channels[1], channels[2], 255]));
  });
  if (!seenHeader) throw unprocessable({ file: 'Use a .hex or .gpl file' });
  return { colours };
}

export async function swatchBodies(
  client: PoolClient,
  paletteId: number,
  usage: Map<number, { pixels: number; frames: number }>,
): Promise<Record<string, unknown>[]> {
  const order = await paletteOrder(client, paletteId);
  const swatches = new Map((await swatchesOf(client, paletteId)).map((swatch) => [swatch.index, swatch]));
  return order.map((index) => {
    const swatch = swatches.get(index) as SwatchRow;
    return {
      index,
      color: swatch.color,
      version: swatch.version,
      used_by: usage.get(index)?.pixels ?? 0,
      frames: usage.get(index)?.frames ?? 0,
      edited_by: swatch.edited_by_name,
    };
  });
}
