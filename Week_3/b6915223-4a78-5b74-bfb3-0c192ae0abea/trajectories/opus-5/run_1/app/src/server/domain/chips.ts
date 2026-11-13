import type { ChipCode, ChipState } from '../../shared/types.ts';

export const SEASON_HALF_LAST_GAMEWEEK = 18;

export const seasonHalf = (gameweek: number): 1 | 2 =>
  gameweek <= SEASON_HALF_LAST_GAMEWEEK ? 1 : 2;

export interface PlayedChip {
  gameweek: number;
  chip: ChipCode;
}

export interface ChipPlayInput {
  gameweek: number;
  chip: ChipCode;
  played: PlayedChip[];
  transfersMadeThisGameweek: number;
}

/** The one place a chip refusal is decided, in the published order. */
export const chipRefusalCode = (input: ChipPlayInput): string | null => {
  const { gameweek, chip, played, transfersMadeThisGameweek } = input;
  if (played.some((entry) => entry.gameweek === gameweek)) {
    return 'chip_already_this_gameweek';
  }
  if (
    played.some(
      (entry) => entry.chip === chip && seasonHalf(entry.gameweek) === seasonHalf(gameweek),
    )
  ) {
    return 'chip_used';
  }
  if (
    chip === 'free_hit' &&
    played.some((entry) => entry.chip === 'free_hit' && entry.gameweek === gameweek - 1)
  ) {
    return 'free_hit_back_to_back';
  }
  if ((chip === 'wildcard' || chip === 'free_hit') && transfersMadeThisGameweek > 0) {
    return 'chip_after_transfers';
  }
  return null;
};

export const CANCELLABLE_CHIPS: ChipCode[] = ['bench_boost', 'triple_captain'];

export const chipMakesTransfersFree = (chip: ChipCode | null): boolean =>
  chip === 'wildcard' || chip === 'free_hit';

/** Each chip's state for the current half of the season. */
export const chipStates = (
  currentGameweek: number,
  played: PlayedChip[],
): Record<ChipCode, ChipState> => {
  const half = seasonHalf(currentGameweek);
  const active = played.find((entry) => entry.gameweek === currentGameweek)?.chip ?? null;
  const build = (chip: ChipCode): ChipState => {
    if (active === chip) return 'active';
    const usedInHalf = played.some(
      (entry) => entry.chip === chip && seasonHalf(entry.gameweek) === half,
    );
    return usedInHalf ? 'used' : 'available';
  };
  return {
    wildcard: build('wildcard'),
    free_hit: build('free_hit'),
    bench_boost: build('bench_boost'),
    triple_captain: build('triple_captain'),
  };
};
