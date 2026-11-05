/** Short-unit selection: the one place missing units are chosen. */
export function selectShortUnits(
  deliveredUnits: number,
  alreadyShort: ReadonlySet<number>,
  units: number,
): number[] {
  const chosen: number[] = [];
  for (let unit = deliveredUnits; unit >= 1 && chosen.length < units; unit -= 1) {
    if (!alreadyShort.has(unit)) chosen.push(unit);
  }
  return chosen;
}
