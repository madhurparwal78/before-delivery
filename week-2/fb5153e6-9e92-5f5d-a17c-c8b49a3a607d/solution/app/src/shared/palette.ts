/** The drafting-table palette, shared by the stylesheet and the preview renderer. */
export const palette = {
  /** The page ground: a warm bone off-white. */
  bone: '#f4f1ea',
  /** Near-black blue-tinted ink for text. */
  ink: '#151a22',
  /** Muted ink, for secondary text and disabled labels. */
  inkMuted: '#5a6070',
  /** Warm stone grey for one-pixel hairline rules. */
  stone: '#c7c1b4',
  /** Deep sea-teal for primary buttons and links. */
  teal: '#0f6e70',
  tealDark: '#0a5456',
  /** Reserved for active measurement marks and the focus ring. */
  vermilion: '#d4401f',
  /** The quiet material the rendered preview uses. */
  material: '#b9b2a4',
} as const;

export function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
