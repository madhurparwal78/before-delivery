import { isSkyPoint } from './pair.js';
import type { SkyPoint, Star, Stroke, StrokeFile, StrokeWidth } from './types.js';

export const STROKE_FILE_FORMAT = 'lowlamp-strokes/1';
export const MAX_SKETCH_BYTES = 2_000_000;
export const STROKE_WIDTHS: readonly StrokeWidth[] = ['fine', 'medium', 'broad'];

function parseStroke(value: unknown): Stroke | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!STROKE_WIDTHS.includes(raw.width as StrokeWidth)) return null;
  if (!Array.isArray(raw.points)) return null;
  const points: SkyPoint[] = [];
  for (const point of raw.points) {
    if (!isSkyPoint(point)) return null;
    points.push(point);
  }
  return { width: raw.width as StrokeWidth, points };
}

function parseStar(value: unknown): Star | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isSkyPoint(raw.at)) return null;
  const brightness = raw.brightness;
  if (typeof brightness !== 'number' || !Number.isInteger(brightness)) return null;
  if (brightness < 1 || brightness > 5) return null;
  return { at: raw.at, brightness: brightness as Star['brightness'] };
}

/** Parse stroke file text, or return null when it is not a Lowlamp stroke file. */
export function parseStrokeFile(text: string): StrokeFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.format !== STROKE_FILE_FORMAT) return null;
  if (!Array.isArray(raw.strokes) || !Array.isArray(raw.stars)) return null;
  const strokes: Stroke[] = [];
  for (const entry of raw.strokes) {
    const stroke = parseStroke(entry);
    if (!stroke) return null;
    strokes.push(stroke);
  }
  const stars: Star[] = [];
  for (const entry of raw.stars) {
    const star = parseStar(entry);
    if (!star) return null;
    stars.push(star);
  }
  return { format: STROKE_FILE_FORMAT, strokes, stars };
}

export function serialiseStrokeFile(file: StrokeFile): string {
  return JSON.stringify({
    format: STROKE_FILE_FORMAT,
    strokes: file.strokes.map((stroke) => ({ width: stroke.width, points: stroke.points })),
    stars: file.stars.map((star) => ({ at: star.at, brightness: star.brightness })),
  });
}

/** An observation has a sketch when its stroke file holds at least one stroke or star. */
export function hasMarks(file: StrokeFile): boolean {
  return file.strokes.length > 0 || file.stars.length > 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}
