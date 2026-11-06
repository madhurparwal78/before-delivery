// Theme tokens: the only colour values in the workspace.

export type ThemeName = 'paper' | 'lamplight';
export type TokenName = 'paper' | 'ink' | 'rule' | 'accent' | 'link';
export type Rgb = readonly [number, number, number];

export const TOKEN_NAMES: readonly TokenName[] = ['paper', 'ink', 'rule', 'accent', 'link'];

export const TOKEN_VARS: Readonly<Record<TokenName, string>> = {
  paper: '--quire-paper',
  ink: '--quire-ink',
  rule: '--quire-rule',
  accent: '--quire-accent',
  link: '--quire-link',
};

export const THEMES: Readonly<Record<ThemeName, Readonly<Record<TokenName, Rgb>>>> = {
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

export const HEAT_BAND_PX = 12;
/** block count at which a heat band reaches the full accent */
export const HEAT_FULL = 6;

export function rgbCss(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** The five custom property declarations for a theme, plus the paper token at zero opacity for fades and washes. */
export function tokenCss(theme: ThemeName): string {
  const paper = THEMES[theme].paper;
  const tokens = TOKEN_NAMES.map((name) => `${TOKEN_VARS[name]}: ${rgbCss(THEMES[theme][name])};`).join(' ');
  return `${tokens} --quire-clear: rgb(${paper[0]} ${paper[1]} ${paper[2]} / 0);`;
}

/** Token channels divided by 255, for WebGL. */
export function glColor(rgb: Rgb): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** Heat band colour for `n` blocks, mixed from paper toward accent. */
export function heatColor(theme: ThemeName, n: number): Rgb {
  const { paper, accent } = THEMES[theme];
  const k = Math.min(1, n / HEAT_FULL);
  return [
    Math.round(paper[0] + (accent[0] - paper[0]) * k),
    Math.round(paper[1] + (accent[1] - paper[1]) * k),
    Math.round(paper[2] + (accent[2] - paper[2]) * k),
  ];
}
