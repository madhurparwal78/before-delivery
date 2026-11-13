/** Price per seat for a segment: floor(whole price x segment km / route km). */
export function segmentPriceCents(
  wholePriceCents: number,
  segmentKm: number,
  routeKm: number,
): number {
  return Math.floor((wholePriceCents * segmentKm) / routeKm);
}
