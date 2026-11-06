/** The one place the waxy palette is defined; CSS reads it as custom properties. */
export const PALETTE = {
  ground: '#f2ead9',
  ink: '#1c1a17',
  accent: '#9b4521',
  accentDeep: '#7e3417',
  sage: '#5f7257',
  rule: '#d6c8ae',
  kraft: '#7a5a34',
  inkSoft: '#4a443b',
} as const;

export const TINTS: Record<string, string> = {
  lilac: '#6f6499',
  ash: '#5c5e5a',
  mint: '#3f7a62',
  rose: '#9a5f63',
};

export function tintColour(name: string): string {
  return TINTS[name] ?? PALETTE.sage;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function installPalette(): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(PALETTE)) {
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
  }
  for (const [name, value] of Object.entries(TINTS)) {
    root.style.setProperty(`--tint-${name}`, value);
  }
}
