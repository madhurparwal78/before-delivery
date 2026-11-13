// Colour slug to the swatch and bag colour drawn on screen.

const HEX: Record<string, string> = {
  graphite: "#3b3f45",
  sage: "#8fa58a",
  "signal-red": "#d6281c",
  silver: "#c4c8cc",
  navy: "#1f2f5a",
  teal: "#0f8f82",
  yellow: "#f5b700",
  blue: "#2a52d9",
  sand: "#d8c3a0",
  tan: "#b07d4b",
  black: "#17181a",
  grey: "#8a8d91",
};

export function colourHex(slug: string): string {
  return HEX[slug] ?? "#777777";
}
