import { CHIPS, type ChipCode, type ChipState } from "../../shared/api.ts";

// Chip rules (brief: Business rules / Chips). The season has two halves: gameweeks 1-18 and 19-36.
const half = (gameweek: number) => (gameweek <= 18 ? 1 : 2);

export function chipRefusal(input: {
  chip: ChipCode;
  gameweek: number;
  chipsByGameweek: ReadonlyMap<number, ChipCode>;
  transfersMade: number;
}): string | null {
  const { chip, gameweek, chipsByGameweek } = input;
  if (chipsByGameweek.has(gameweek)) return "chip_already_this_gameweek";
  for (const [played, code] of chipsByGameweek) {
    if (code === chip && half(played) === half(gameweek)) return "chip_used";
  }
  if (chip === "free_hit" && chipsByGameweek.get(gameweek - 1) === "free_hit") return "free_hit_back_to_back";
  if ((chip === "wildcard" || chip === "free_hit") && input.transfersMade > 0) return "chip_after_transfers";
  return null;
}

export function chipCancellable(chip: ChipCode): boolean {
  return chip === "bench_boost" || chip === "triple_captain";
}

export function chipStates(gameweek: number, chipsByGameweek: ReadonlyMap<number, ChipCode>): Record<ChipCode, ChipState> {
  const states = Object.fromEntries(CHIPS.map((chip) => [chip, "available"])) as Record<ChipCode, ChipState>;
  for (const [played, code] of chipsByGameweek) {
    if (played === gameweek) states[code] = "active";
    else if (half(played) === half(gameweek) && states[code] !== "active") states[code] = "used";
  }
  return states;
}
