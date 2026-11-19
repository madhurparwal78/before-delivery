// The colour chapter's published swatch table (brief: Seed data / Colour chapter swatch table), verbatim.
export const FAMILIES = ["Ember", "Saffron", "Meadow", "Lagoon", "Harbour", "Iris", "Orchid", "Clay", "Moss", "Stone"] as const;
export type Family = (typeof FAMILIES)[number];

interface Swatch {
  family: Family;
  name: string;
  hex: string;
  onWhite: string;
  onWhiteRating: string;
  onInk: string;
  onInkRating: string;
}

const rows: [Family, string, string, string, string, string, string][] = [
  ["Ember", "Ember 700", "A3341F", "6.84:1", "AA", "2.63:1", "Fail"],
  ["Ember", "Ember 300", "F2A08C", "2.06:1", "Fail", "8.72:1", "AAA"],
  ["Saffron", "Saffron 700", "9A5B00", "5.43:1", "AA", "3.31:1", "AA Large"],
  ["Saffron", "Saffron 300", "F7C266", "1.63:1", "Fail", "11.01:1", "AAA"],
  ["Meadow", "Meadow 700", "2F6B2A", "6.45:1", "AA", "2.79:1", "Fail"],
  ["Meadow", "Meadow 300", "A9D99A", "1.61:1", "Fail", "11.20:1", "AAA"],
  ["Lagoon", "Lagoon 700", "00666B", "6.75:1", "AA", "2.67:1", "Fail"],
  ["Lagoon", "Lagoon 300", "7FD3D0", "1.73:1", "Fail", "10.39:1", "AAA"],
  ["Harbour", "Harbour 700", "1F4E8C", "8.31:1", "AAA", "2.16:1", "Fail"],
  ["Harbour", "Harbour 300", "9DBDF0", "1.91:1", "Fail", "9.39:1", "AAA"],
  ["Iris", "Iris 700", "5B3A9E", "8.26:1", "AAA", "2.18:1", "Fail"],
  ["Iris", "Iris 300", "C6B2F0", "1.90:1", "Fail", "9.44:1", "AAA"],
  ["Orchid", "Orchid 700", "8E2C77", "7.56:1", "AAA", "2.38:1", "Fail"],
  ["Orchid", "Orchid 300", "EDA8DC", "1.87:1", "Fail", "9.62:1", "AAA"],
  ["Clay", "Clay 700", "7A4A33", "7.36:1", "AAA", "2.44:1", "Fail"],
  ["Clay", "Clay 300", "E0B9A0", "1.81:1", "Fail", "9.95:1", "AAA"],
  ["Moss", "Moss 700", "4F5A1E", "7.46:1", "AAA", "2.41:1", "Fail"],
  ["Moss", "Moss 300", "CFD88E", "1.51:1", "Fail", "11.87:1", "AAA"],
  ["Stone", "Stone 700", "4D4A55", "8.66:1", "AAA", "2.08:1", "Fail"],
  ["Stone", "Stone 300", "C9C6CF", "1.69:1", "Fail", "10.67:1", "AAA"],
];

export const SWATCHES: readonly Swatch[] = rows.map(([family, name, hex, onWhite, onWhiteRating, onInk, onInkRating]) => ({
  family,
  name,
  hex,
  onWhite,
  onWhiteRating,
  onInk,
  onInkRating,
}));
