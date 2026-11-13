// Residuals: each sample's distance from the reference position interpolated
// at its UTC, computed in one place.

export interface ReferenceVector {
  unix_ms: number;
  x_m: number;
  y_m: number;
  z_m: number;
}

export function residualAt(
  vectors: ReferenceVector[],
  unixMs: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
): number | null {
  if (vectors.length === 0) return null;
  if (unixMs < vectors[0].unix_ms) return null;
  if (unixMs > vectors[vectors.length - 1].unix_ms) return null;
  // Find the bracketing pair.
  let lo = 0;
  let hi = vectors.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vectors[mid].unix_ms <= unixMs) {
      lo = mid;
      if (hi - lo === 1) break;
      if (vectors[mid].unix_ms === unixMs) {
        hi = mid;
        break;
      }
      // refine
      if (mid + 1 < vectors.length && vectors[mid + 1].unix_ms > unixMs) {
        hi = mid + 1;
        break;
      }
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  void hi;
  const a = vectors[lo];
  const b = vectors[Math.min(lo + 1, vectors.length - 1)];
  if (a.unix_ms === unixMs) {
    return distance(sampleX, sampleY, sampleZ, a.x_m, a.y_m, a.z_m);
  }
  if (b.unix_ms <= a.unix_ms) return null;
  const span = b.unix_ms - a.unix_ms;
  const t = (unixMs - a.unix_ms) / span;
  const rx = a.x_m + (b.x_m - a.x_m) * t;
  const ry = a.y_m + (b.y_m - a.y_m) * t;
  const rz = a.z_m + (b.z_m - a.z_m) * t;
  return distance(sampleX, sampleY, sampleZ, rx, ry, rz);
}

function distance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

// Simple linear scan alternative used when exact bracketing matters.
export function findBracket(
  vectors: ReferenceVector[],
  unixMs: number,
): { a: ReferenceVector | null; b: ReferenceVector | null } {
  if (vectors.length === 0) return { a: null, b: null };
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].unix_ms === unixMs) {
      return { a: vectors[i], b: vectors[i] };
    }
  }
  let a: ReferenceVector | null = null;
  let b: ReferenceVector | null = null;
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].unix_ms < unixMs) a = vectors[i];
  }
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].unix_ms > unixMs) {
      b = vectors[i];
      break;
    }
  }
  return { a, b };
}
