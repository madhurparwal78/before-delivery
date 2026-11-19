// Rules about positions along a corridor, shared by the server and the page.

export interface TowerMark {
  number: number;
  chainageM: number;
  baseHeightM: number;
}

/** A chainage belongs to the span from tower k to k+1 when at or after k and before k+1; the end belongs to the last span. */
export function spanAt(towers: readonly TowerMark[], chainageM: number): { fromTower: number; toTower: number } {
  let index = 0;
  while (index < towers.length - 2 && chainageM >= (towers[index + 1]?.chainageM ?? Infinity)) index += 1;
  const from = towers[index]?.number ?? 1;
  return { fromTower: from, toTower: from + 1 };
}

/** The linear interpolation, by chainage, of the neighbouring towers' base heights, held at the ends. */
export function baseHeightAt(towers: readonly TowerMark[], chainageM: number): number {
  const first = towers[0];
  const last = towers[towers.length - 1];
  if (first === undefined || last === undefined) return 0;
  const c = Math.min(Math.max(chainageM, first.chainageM), last.chainageM);
  for (let i = 1; i < towers.length; i += 1) {
    const a = towers[i - 1];
    const b = towers[i];
    if (a === undefined || b === undefined || c > b.chainageM) continue;
    return a.baseHeightM + ((b.baseHeightM - a.baseHeightM) * (c - a.chainageM)) / (b.chainageM - a.chainageM);
  }
  return last.baseHeightM;
}
