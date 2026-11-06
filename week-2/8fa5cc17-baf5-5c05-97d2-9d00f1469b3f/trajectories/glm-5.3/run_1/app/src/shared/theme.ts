// The theme token values. The single home of the palette: every colour in
// the workspace and the graph comes from these five tokens per theme.

export interface ThemeTokens {
  paper: [number, number, number];
  ink: [number, number, number];
  rule: [number, number, number];
  accent: [number, number, number];
  link: [number, number, number];
}

export const THEMES: Record<"paper" | "lamplight", ThemeTokens> = {
  paper: {
    paper: [244, 240, 230],
    ink: [31, 28, 24],
    rule: [207, 198, 180],
    accent: [178, 58, 36],
    link: [47, 107, 106],
  },
  lamplight: {
    paper: [30, 26, 21],
    ink: [237, 228, 211],
    rule: [74, 65, 54],
    accent: [224, 103, 76],
    link: [127, 184, 181],
  },
};

export function cssColor(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function tokenVars(theme: "paper" | "lamplight"): string {
  const t = THEMES[theme];
  return [
    `--quire-paper: ${t.paper.join(", ")}`,
    `--quire-ink: ${t.ink.join(", ")}`,
    `--quire-rule: ${t.rule.join(", ")}`,
    `--quire-accent: ${t.accent.join(", ")}`,
    `--quire-link: ${t.link.join(", ")}`,
  ].join("; ");
}
