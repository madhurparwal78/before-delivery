import { SeasonState } from './workbook';

export type SeasonAction = 'start' | 'close' | 'reopen' | 'archive';

const TRANSITIONS: Record<SeasonAction, { from: SeasonState; to: SeasonState }> = {
  start: { from: 'draft', to: 'in_season' },
  close: { from: 'in_season', to: 'locked' },
  reopen: { from: 'locked', to: 'in_season' },
  archive: { from: 'locked', to: 'archived' },
};

/** The season state machine: the only legal moves. */
export function nextSeasonState(state: SeasonState, action: SeasonAction): SeasonState | null {
  const transition = TRANSITIONS[action];
  return transition.from === state ? transition.to : null;
}

export const SEASON_LABELS: Record<SeasonState, string> = {
  draft: 'Draft',
  in_season: 'In season',
  locked: 'Locked',
  archived: 'Archived',
};

export const SEASON_WORDS: Record<SeasonState, string> = {
  draft: 'draft',
  in_season: 'in season',
  locked: 'locked',
  archived: 'archived',
};
