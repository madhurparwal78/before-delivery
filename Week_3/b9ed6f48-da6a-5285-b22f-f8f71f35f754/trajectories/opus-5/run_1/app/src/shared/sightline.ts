export const YAW_MIN = -60;
export const YAW_MAX = 60;
export const YAW_SPAN = YAW_MAX - YAW_MIN;
export const YAW_STEP = 3;
export const RESOLVE_WINDOW_DEG = 2.5;

const BASE_VIEWPOINTS: readonly number[] = [-60, -40, -20, 0, 20, 40, 60];

/** Rounds to a whole degree, halves away from zero, then clamps to the orbit. */
export function quantiseYaw(yaw: number): number {
  const rounded = yaw < 0 ? -Math.round(-yaw) : Math.round(yaw);
  return Math.min(YAW_MAX, Math.max(YAW_MIN, rounded));
}

/**
 * `round(100 × (1 − d / 120))`, halves up. Computed over integers so an exact half, such as
 * chapter I seen from -60°, rounds up rather than falling foul of binary fractions.
 */
export function alignmentPercent(yaw: number, sightlineDeg: number): number {
  const distance = Math.abs(yaw - sightlineDeg);
  return Math.floor(((YAW_SPAN - distance) * 100 * 2 + YAW_SPAN) / (YAW_SPAN * 2));
}

export function isWithinResolveWindow(yaw: number, sightlineDeg: number): boolean {
  return Math.abs(yaw - sightlineDeg) <= RESOLVE_WINDOW_DEG;
}

/** The seven still viewpoints: the base ring with the one nearest the sightline replaced by it. */
export function viewpointsFor(sightlineDeg: number): number[] {
  let chosen = BASE_VIEWPOINTS[0] as number;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const angle of BASE_VIEWPOINTS) {
    const distance = Math.abs(angle - sightlineDeg);
    if (distance < bestDistance || (distance === bestDistance && Math.abs(angle) < Math.abs(chosen))) {
      chosen = angle;
      bestDistance = distance;
    }
  }
  return BASE_VIEWPOINTS.map((angle) => (angle === chosen ? sightlineDeg : angle)).sort((a, b) => a - b);
}

/** Angle format: `+33°`, `-45°`, `0°`. */
export function formatAngle(degrees: number): string {
  if (degrees > 0) return `+${degrees}°`;
  if (degrees < 0) return `-${Math.abs(degrees)}°`;
  return '0°';
}

export const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'] as const;

export function numeralFor(chapterNumber: number): string {
  return NUMERALS[chapterNumber - 1] ?? String(chapterNumber);
}
