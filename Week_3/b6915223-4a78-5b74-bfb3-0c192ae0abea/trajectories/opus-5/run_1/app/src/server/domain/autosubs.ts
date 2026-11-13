import type { ChipCode, Position } from '../../shared/types.ts';

export interface AutoSubInput {
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
  chip: ChipCode | null;
  positionOf: (playerId: string) => Position;
  played: (playerId: string) => boolean;
}

export interface AutoSubResult {
  starting: string[];
  subs: { in: string; out: string }[];
  /** The player who takes the multiplier, or null when neither armband played. */
  captain: string | null;
  captainFellBack: boolean;
}

const shapeValid = (starting: string[], positionOf: (playerId: string) => Position): boolean => {
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of starting) counts[positionOf(id)] += 1;
  return counts.GK === 1 && counts.DEF >= 3 && counts.MID >= 2 && counts.FWD >= 1;
};

/** The one place auto-subs and the captain fallback are decided. */
export const applyAutoSubs = (input: AutoSubInput): AutoSubResult => {
  const { starting, bench, captain, vice_captain, chip, positionOf, played } = input;
  const current = [...starting];
  const subs: { in: string; out: string }[] = [];

  if (chip !== 'bench_boost') {
    const used = new Set<string>();
    for (const starter of starting) {
      if (played(starter)) continue;
      for (const candidate of bench) {
        if (used.has(candidate) || !played(candidate)) continue;
        const attempt = current.map((id) => (id === starter ? candidate : id));
        if (!shapeValid(attempt, positionOf)) continue;
        current.splice(current.indexOf(starter), 1, candidate);
        used.add(candidate);
        subs.push({ in: candidate, out: starter });
        break;
      }
    }
  }

  const captainPlayed = played(captain);
  const vicePlayed = played(vice_captain);
  return {
    starting: current,
    subs,
    captain: captainPlayed ? captain : vicePlayed ? vice_captain : null,
    captainFellBack: !captainPlayed && vicePlayed,
  };
};
