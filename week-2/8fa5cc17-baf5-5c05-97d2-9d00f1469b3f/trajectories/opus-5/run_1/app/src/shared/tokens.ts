export type ThemeName = 'paper' | 'lamplight';

export type ThemeTokens = {
  paper: [number, number, number];
  ink: [number, number, number];
  rule: [number, number, number];
  accent: [number, number, number];
  link: [number, number, number];
};

export const THEME_TOKENS: Record<ThemeName, ThemeTokens> = {
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

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'paper' || value === 'lamplight';
}

export function toUnit(channels: [number, number, number]): [number, number, number] {
  return [channels[0] / 255, channels[1] / 255, channels[2] / 255];
}

export function themeLabel(theme: ThemeName): string {
  return theme === 'paper' ? 'Paper' : 'Lamplight';
}
