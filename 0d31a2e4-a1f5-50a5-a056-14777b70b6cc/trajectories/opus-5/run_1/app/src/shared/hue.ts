const HUES = [30, 40, 50, 60, 185, 200, 215, 230, 250, 270, 290, 310] as const;

/** The single place a player's bean hue is decided. */
export function hueForUserId(userId: number): number {
  return HUES[(userId * 5) % HUES.length];
}

/** A bean body is a strong, mid-light colour: neither pastel nor dark. */
export const BEAN_SATURATION = 0.78;
export const BEAN_LIGHTNESS = 0.62;

export function beanBodyColor(hue: number): string {
  return `hsl(${hue}, ${BEAN_SATURATION * 100}%, ${BEAN_LIGHTNESS * 100}%)`;
}

/** Bean belly highlight, one step lighter than the body. */
export function beanBellyColor(hue: number): string {
  return `hsl(${hue}, 82%, 76%)`;
}
