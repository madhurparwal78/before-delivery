import { hasTwoDecimals } from "./projection";
import type { Point, StrokeFile } from "./types";

export const STROKE_LIMIT = 2_000_000;
const WIDTHS = ["fine", "medium", "broad"];

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && hasTwoDecimals(n))
  );
}

/** The stroke file when `text` is a Lowlamp stroke file within the size limit, otherwise null. */
export function parseStrokeFile(text: string): StrokeFile | null {
  if (byteLength(text) > STROKE_LIMIT) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const file = doc as Record<string, unknown>;
  if (file.format !== "lowlamp-strokes/1" || !Array.isArray(file.strokes) || !Array.isArray(file.stars)) return null;
  const strokesOk = file.strokes.every((s: unknown) => {
    if (typeof s !== "object" || s === null) return false;
    const stroke = s as Record<string, unknown>;
    return typeof stroke.width === "string" && WIDTHS.includes(stroke.width) && Array.isArray(stroke.points) && stroke.points.every(isPoint);
  });
  const starsOk = file.stars.every((s: unknown) => {
    if (typeof s !== "object" || s === null) return false;
    const star = s as Record<string, unknown>;
    return isPoint(star.at) && Number.isInteger(star.brightness) && (star.brightness as number) >= 1 && (star.brightness as number) <= 5;
  });
  return strokesOk && starsOk ? (doc as StrokeFile) : null;
}

export function markCount(file: StrokeFile): number {
  return file.strokes.length + file.stars.length;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function serialiseStrokeFile(file: StrokeFile): string {
  return JSON.stringify({ format: file.format, strokes: file.strokes, stars: file.stars });
}
