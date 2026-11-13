/**
 * Sightline geometry: alignment, resolve window and viewpoints.
 * These rules are decided here and only here.
 */

/** Alignment: round(100 * (1 - d/120)) with halves up, shown as a whole percent. */
export function alignment(yawDeg: number, sightlineDeg: number): number {
  const d = Math.abs(yawDeg - sightlineDeg);
  const scaled = 100 * (1 - d / 120);
  return Math.floor(scaled + 0.5);
}

/** The chapter resolves when |yaw - sightline| <= 2.5. */
export function withinResolveWindow(yawDeg: number, sightlineDeg: number): boolean {
  return Math.abs(yawDeg - sightlineDeg) <= 2.5;
}

/** Round a fractional yaw to the nearest whole degree, halves away from zero. */
export function roundYaw(fractional: number): number {
  return fractional >= 0 ? Math.floor(fractional + 0.5) : Math.ceil(fractional - 0.5);
}

export function clampYaw(yaw: number): number {
  return Math.min(60, Math.max(-60, yaw));
}

/**
 * The seven viewpoints: start from -60, -40, -20, 0, 20, 40, 60; replace the
 * one nearest the sightline angle with the sightline angle itself (ties go to
 * the one nearer 0); list ascending.
 */
export function viewpoints(sightlineDeg: number): number[] {
  const base = [-60, -40, -20, 0, 20, 40, 60];
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < base.length; i++) {
    const dist = Math.abs(base[i]! - sightlineDeg);
    const nearerZero = dist === bestDist && Math.abs(base[i]!) < Math.abs(base[bestIndex]!);
    if (dist < bestDist || nearerZero) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  const out = [...base];
  out[bestIndex] = sightlineDeg;
  return out.sort((a, b) => a - b);
}

/** Angle format: leading + for positive, hyphen-minus for negative, none for zero. */
export function angle(deg: number): string {
  if (deg === 0) return '0°';
  return `${deg > 0 ? '+' : '-'}${Math.abs(deg)}°`;
}
