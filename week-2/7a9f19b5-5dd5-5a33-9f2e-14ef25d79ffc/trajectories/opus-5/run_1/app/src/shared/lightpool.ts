/**
 * The one light-pool formula, used by the server and the browser alike.
 *
 * `h` is the ceiling height: the project's `ceiling_height_mm` in the room, and
 * `PRODUCT_PAGE_CEILING_MM` on product pages and in comparisons. Lux is measured
 * on the floor directly below the fitting. All rounding takes halves up, which is
 * what `Math.round` does for the non-negative figures here.
 */

export const PRODUCT_PAGE_CEILING_MM = 2700;

export interface LitFitting {
  x_mm: number;
  y_mm: number;
  beam_deg: number;
  candela: number;
}

const degreesToRadians = (deg: number): number => (deg * Math.PI) / 180;

/** The exact pool diameter in mm, before rounding; the overlap test uses this. */
export function exactPoolDiameterMm(beamDeg: number, ceilingHeightMm: number): number {
  return 2 * ceilingHeightMm * Math.tan(degreesToRadians(beamDeg / 2));
}

/** Pool diameter in mm = 2 x h x tan(beam / 2), to the nearest whole mm. */
export function poolDiameterMm(beamDeg: number, ceilingHeightMm: number): number {
  return Math.round(exactPoolDiameterMm(beamDeg, ceilingHeightMm));
}

/** own_lux = candela / (h in metres)^2, to the nearest whole lux. */
export function ownLux(candela: number, ceilingHeightMm: number): number {
  const metres = ceilingHeightMm / 1000;
  return Math.round(candela / (metres * metres));
}

/**
 * centre_lux of P is the sum over every fitting Q (P included) of
 * candela(Q) x cos^3(theta) / (h in metres)^2, where theta = atan(d / h) and d is
 * the horizontal distance between the centres. Q counts only when d is no more
 * than half of Q's unrounded pool diameter.
 */
export function centreLux(target: LitFitting, all: ReadonlyArray<LitFitting>, ceilingHeightMm: number): number {
  const metres = ceilingHeightMm / 1000;
  const divisor = metres * metres;
  let sum = 0;
  for (const q of all) {
    const dx = target.x_mm - q.x_mm;
    const dy = target.y_mm - q.y_mm;
    const d = Math.hypot(dx, dy);
    if (d > exactPoolDiameterMm(q.beam_deg, ceilingHeightMm) / 2) continue;
    const theta = Math.atan(d / ceilingHeightMm);
    const cos = Math.cos(theta);
    sum += (q.candela * cos * cos * cos) / divisor;
  }
  return Math.round(sum);
}

/** Pool diameter and own lux for a single fitting, as product pages and comparisons show them. */
export function soloPool(
  beamDeg: number,
  candela: number,
  ceilingHeightMm: number,
): { pool_diameter_mm: number; centre_lux: number } {
  return {
    pool_diameter_mm: poolDiameterMm(beamDeg, ceilingHeightMm),
    centre_lux: ownLux(candela, ceilingHeightMm),
  };
}
