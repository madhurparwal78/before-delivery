// The bundled typefaces, loaded once for the PDF and PNG renderers.
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { APP_ROOT } from "../http.js";

export type Face = "serif" | "sans" | "sansBold";

const FILES: Record<Face, string> = {
  serif: "InstrumentSerif-Regular.ttf",
  sans: "IBMPlexSans-Regular.ttf",
  sansBold: "IBMPlexSans-SemiBold.ttf",
};

const cache = new Map<Face, { font: fontkit.Font; bytes: Buffer }>();

export function face(name: Face): { font: fontkit.Font; bytes: Buffer } {
  const hit = cache.get(name);
  if (hit) return hit;
  const bytes = fs.readFileSync(path.join(APP_ROOT, "public", "fonts", FILES[name]));
  const loaded = fontkit.create(bytes);
  if (!("unitsPerEm" in loaded)) throw new Error(`${FILES[name]} is a collection`);
  const entry = { font: loaded, bytes };
  cache.set(name, entry);
  return entry;
}

/** Glyphs one-to-one with characters (no shaping, so every glyph maps back to exactly one character). */
export function glyphs(name: Face, text: string): fontkit.Glyph[] {
  const { font } = face(name);
  return [...text].map((char) => font.glyphForCodePoint(char.codePointAt(0) ?? 32));
}

function textWidth(name: Face, text: string, size: number): number {
  const { font } = face(name);
  return glyphs(name, text).reduce((sum, g) => sum + g.advanceWidth, 0) * (size / font.unitsPerEm);
}

/** Greedy word wrap to a width; long words are broken by character. */
export function wrap(name: Face, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(name, candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let piece = "";
    for (const char of word) {
      if (textWidth(name, piece + char, size) > width && piece) {
        lines.push(piece);
        piece = "";
      }
      piece += char;
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
