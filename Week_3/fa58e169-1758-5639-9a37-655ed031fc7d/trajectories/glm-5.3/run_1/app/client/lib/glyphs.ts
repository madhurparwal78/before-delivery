/** Original drawn vector glyphs for each stitch, following chart conventions. */
export interface Glyph {
  path: string;
  extra?: string;
}

const glyphs: Record<string, Glyph> = {
  k: { path: "M4 6 L16 6 M4 10 L16 10 M4 14 L16 14" },
  p: { path: "M4 6 L16 6 M4 10 L16 10 M4 14 L16 14", extra: "M10 6 A2.4 2.4 0 1 0 10 10.8 A2.4 2.4 0 1 0 10 6" },
  yo: { path: "M10 3 A5 5 0 1 0 10 13 A5 5 0 1 0 10 3" },
  k2tog: { path: "M4 5 L15 11 M15 5 L4 11 M6 14 L13 14" },
  ssk: { path: "M5 11 L16 5 M5 5 L16 11 M7 14 L14 14" },
  cdd: { path: "M10 3 L10 13 M4 6 L10 10 L16 6 M10 15 L10 15" },
  m1l: { path: "M7 4 L7 16 M7 4 L11 8 M7 4 L3 8" },
  m1r: { path: "M13 4 L13 16 M13 4 L9 8 M13 4 L17 8" },
  ns: { path: "" },
  c22: { path: "M6 4 C2 8 2 12 6 16 M14 4 C18 8 18 12 14 16" },
  sc: { path: "M10 4 L10 12 M10 12 A4 4 0 1 0 10 14.5 M7 7 L13 7" },
  hdc: { path: "M10 4 L10 13 M10 13 A4 3 0 1 0 10 16 M6 6 L10 9 L14 6" },
  dc: { path: "M10 3 L10 14 M10 14 A5 4 0 1 0 10 17 M5 6 L10 10 L15 6" },
  inc: { path: "M7 5 L7 14 M13 5 L13 14 M7 14 A4 4 0 0 0 13 14" },
  dec: { path: "M7 5 L10 12 L13 5 M10 12 L10 16" },
};

export function stitchGlyph(key: string): Glyph {
  return glyphs[key] ?? { path: "" };
}

/** A per-family tint for the symbol radio tiles, in published order. */
export const familyTints: Record<string, string> = {
  k: "blue",
  p: "rose",
  yo: "green",
  k2tog: "tan",
  ssk: "butter",
  cdd: "lilac",
  m1l: "sage",
  m1r: "pink",
  ns: "periwinkle",
  c22: "teal",
  sc: "green",
  hdc: "tan",
  dc: "butter",
  inc: "lilac",
  dec: "sage",
};
