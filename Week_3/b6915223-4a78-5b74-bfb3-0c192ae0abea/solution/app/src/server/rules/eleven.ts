import type { Position, Rule } from "../../shared/api.ts";

// Shape, captain, default eleven and eleven order (brief: Business rules).
const POSITION_ORDER: readonly Position[] = ["GK", "DEF", "MID", "FWD"];

interface Placed {
  id: string;
  position: Position;
}

function shapeBreaks(starting: readonly Placed[]): Rule[] {
  const count = (position: Position) => starting.filter((player) => player.position === position).length;
  const rules: Rule[] = [];
  if (count("GK") !== 1) rules.push({ code: "shape_goalkeeper", message: "the eleven needs exactly 1 goalkeeper" });
  if (count("DEF") < 3) rules.push({ code: "shape_defenders", message: "the eleven needs at least 3 defenders" });
  if (count("MID") < 2) rules.push({ code: "shape_midfielders", message: "the eleven needs at least 2 midfielders" });
  if (count("FWD") < 1) rules.push({ code: "shape_forwards", message: "the eleven needs at least 1 forward" });
  return rules;
}

export function shapeHolds(starting: readonly Placed[]): boolean {
  return shapeBreaks(starting).length === 0;
}

export function elevenRuleBreaks(
  starting: readonly Placed[],
  bench: readonly Placed[],
  captain: string,
  viceCaptain: string,
): Rule[] {
  const rules: Rule[] = [];
  if (starting.length !== 11 || bench.length !== 4) {
    rules.push({ code: "eleven_size", message: "the eleven needs exactly 11 players and the bench 4" });
  }
  rules.push(...shapeBreaks(starting));
  const starters = new Set(starting.map((player) => player.id));
  if (captain === viceCaptain || !starters.has(captain) || !starters.has(viceCaptain)) {
    rules.push({ code: "captain", message: "the captain and vice-captain must be two different starters" });
  }
  return rules;
}

// Goalkeeper first, then defenders, midfielders and forwards; the order within a position is kept.
export function inElevenOrder<T extends Placed>(starting: readonly T[]): T[] {
  return POSITION_ORDER.flatMap((position) => starting.filter((player) => player.position === position));
}

interface Priced extends Placed {
  price_tenths: number;
}

const byPriceThenId = (a: Priced, b: Priced) => b.price_tenths - a.price_tenths || (a.id < b.id ? -1 : 1);

export function defaultEleven(squad: readonly Priced[]): { starting: string[]; bench: string[]; captain: string; viceCaptain: string } {
  const take = { GK: 1, DEF: 4, MID: 4, FWD: 2 } as const;
  const starting: Priced[] = [];
  const bench: Priced[] = [];
  for (const position of POSITION_ORDER) {
    const group = squad.filter((player) => player.position === position).sort(byPriceThenId);
    starting.push(...group.slice(0, take[position]));
    bench.push(...group.slice(take[position]));
  }
  const ranked = [...starting].sort(byPriceThenId);
  return { starting: starting.map((p) => p.id), bench: bench.map((p) => p.id), captain: ranked[0]!.id, viceCaptain: ranked[1]!.id };
}
