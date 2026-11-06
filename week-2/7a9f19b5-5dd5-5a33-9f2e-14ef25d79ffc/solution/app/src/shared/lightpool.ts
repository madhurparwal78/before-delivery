// The one light-pool formula, used by the server (placements, comparison, spec sheets) and the browser
// (readouts, room, light-pools table).

/** Ceiling height used on product pages and in comparisons. */
export const REFERENCE_CEILING_MM = 2700;

const DEGREE = Math.PI / 180;

function halfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** Unrounded pool radius on the floor for a beam from a ceiling of `ceilingMm`. */
export function poolRadiusMm(ceilingMm: number, beamDeg: number): number {
  return ceilingMm * Math.tan((beamDeg / 2) * DEGREE);
}

export function poolDiameterMm(ceilingMm: number, beamDeg: number): number {
  return halfUp(2 * poolRadiusMm(ceilingMm, beamDeg));
}

export function ownLux(candela: number, ceilingMm: number): number {
  return halfUp(candela / (ceilingMm / 1000) ** 2);
}

interface Spot {
  x_mm: number;
  y_mm: number;
  beam_deg: number;
  candela: number;
}

/** Summed lux on the floor directly below `target`, from every spot whose pool reaches it (target included). */
function centreLux(target: Spot, spots: readonly Spot[], ceilingMm: number): number {
  let total = 0;
  for (const spot of spots) {
    const distance = Math.hypot(spot.x_mm - target.x_mm, spot.y_mm - target.y_mm);
    if (distance <= poolRadiusMm(ceilingMm, spot.beam_deg)) {
      total += (spot.candela * Math.cos(Math.atan(distance / ceilingMm)) ** 3) / (ceilingMm / 1000) ** 2;
    }
  }
  return halfUp(total);
}

interface PoolFigures {
  pool_diameter_mm: number;
  own_lux: number;
  centre_lux: number;
}

/** Figures for every spot in a room, in the order given. */
export function roomFigures<T extends Spot>(spots: readonly T[], ceilingMm: number): (T & PoolFigures)[] {
  return spots.map((spot) => ({
    ...spot,
    pool_diameter_mm: poolDiameterMm(ceilingMm, spot.beam_deg),
    own_lux: ownLux(spot.candela, ceilingMm),
    centre_lux: centreLux(spot, spots, ceilingMm),
  }));
}
