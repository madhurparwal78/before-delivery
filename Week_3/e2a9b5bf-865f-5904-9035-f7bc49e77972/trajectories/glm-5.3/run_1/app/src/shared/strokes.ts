// Shared shapes for the stroke file and every sentence the browser shows
// that depends on server data.
import type { SkyPoint } from "./projection.js";

export interface StrokeFile {
  readonly format: "lowlamp-strokes/1";
  readonly strokes: readonly { readonly width: "fine" | "medium" | "broad"; readonly points: readonly SkyPoint[] }[];
  readonly stars: readonly { readonly at: SkyPoint; readonly brightness: number }[];
}

export const STROKE_FILE_LIMIT_BYTES = 2_000_000;
export const RASTER_LIMIT_BYTES = 2_000_000;
export const SYNC_CHANGE_LIMIT = 200;
export const SYNC_BODY_LIMIT_BYTES = 5_000_000;
export const OTHER_BODY_LIMIT_BYTES = 100_000;
export const PACKET_ROW_LIMIT = 200;
export const DESCRIPTION_LIMIT = 4_000;

export function strokesToJson(file: StrokeFile): string {
  return JSON.stringify({ format: "lowlamp-strokes/1", strokes: file.strokes, stars: file.stars });
}

export function strokeFileEquals(a: StrokeFile, b: StrokeFile): boolean {
  return strokesToJson(a) === strokesToJson(b);
}

export function strokeFileHasMarks(file: StrokeFile | null): boolean {
  return !!file && (file.strokes.length > 0 || file.stars.length > 0);
}

export function parseStrokeFileText(text: string): StrokeFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj["format"] !== "lowlamp-strokes/1") return null;
  if (!Array.isArray(obj["strokes"]) || !Array.isArray(obj["stars"])) return null;
  const strokes: { width: "fine" | "medium" | "broad"; points: SkyPoint[] }[] = [];
  for (const s of obj["strokes"]) {
    if (typeof s !== "object" || s === null) return null;
    const so = s as Record<string, unknown>;
    if (so["width"] !== "fine" && so["width"] !== "medium" && so["width"] !== "broad") return null;
    const pts = so["points"];
    if (!Array.isArray(pts) || pts.length === 0) return null;
    const points: SkyPoint[] = [];
    for (const p of pts) {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const e = p[0], n = p[1];
      if (typeof e !== "number" || typeof n !== "number" || !Number.isFinite(e) || !Number.isFinite(n)) return null;
      points.push([e, n]);
    }
    strokes.push({ width: so["width"], points });
  }
  const stars: { at: SkyPoint; brightness: number }[] = [];
  for (const s of obj["stars"]) {
    if (typeof s !== "object" || s === null) return null;
    const so = s as Record<string, unknown>;
    if (typeof so["brightness"] !== "number" || !Number.isInteger(so["brightness"]) || so["brightness"] < 1 || so["brightness"] > 5) return null;
    const at = so["at"];
    if (!Array.isArray(at) || at.length !== 2) return null;
    const e = at[0], n = at[1];
    if (typeof e !== "number" || typeof n !== "number" || !Number.isFinite(e) || !Number.isFinite(n)) return null;
    stars.push({ at: [e, n], brightness: so["brightness"] });
  }
  return { format: "lowlamp-strokes/1", strokes, stars };
}

export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}
