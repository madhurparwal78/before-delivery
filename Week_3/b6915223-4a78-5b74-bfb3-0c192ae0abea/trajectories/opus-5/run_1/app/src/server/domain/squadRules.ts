import type { BrokenRule, Position } from '../../shared/types.ts';

export const POSITION_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
export const positionRank = (position: Position): number => POSITION_ORDER.indexOf(position);

export const SQUAD_POSITION_COUNTS: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
export const SQUAD_SIZE = 15;
export const CLUB_LIMIT = 3;

const POSITION_RULE_CODES: Record<Position, string> = {
  GK: 'goalkeepers',
  DEF: 'defenders',
  MID: 'midfielders',
  FWD: 'forwards',
};

const POSITION_RULE_MESSAGES: Record<Position, string> = {
  GK: 'the squad needs exactly 2 goalkeepers',
  DEF: 'the squad needs exactly 5 defenders',
  MID: 'the squad needs exactly 5 midfielders',
  FWD: 'the squad needs exactly 3 forwards',
};

export interface SquadRulePlayer {
  id: string;
  club: string;
  position: Position;
}

export interface SquadRuleInput {
  /** Every id of the resulting squad, counted as often as it was sent. */
  ids: string[];
  players: Map<string, SquadRulePlayer>;
  clubNames: Map<string, string>;
  clubOrder: string[];
  overBudget: boolean;
  positionMismatch: boolean;
}

/** The one place the squad rules are decided. */
export const checkSquadRules = (input: SquadRuleInput): BrokenRule[] => {
  const { ids, players, clubNames, clubOrder, overBudget, positionMismatch } = input;
  const broken: BrokenRule[] = [];

  if (ids.length !== SQUAD_SIZE) {
    broken.push({ code: 'squad_size', message: 'the squad needs exactly 15 players' });
  }

  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const duplicates = [...counts.values()].filter((count) => count > 1).length;
  for (let index = 0; index < duplicates; index += 1) {
    broken.push({ code: 'duplicate_player', message: 'a player can only be picked once' });
  }

  const positionCounts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCounts = new Map<string, number>();
  for (const id of ids) {
    const player = players.get(id);
    if (player === undefined) continue;
    positionCounts[player.position] += 1;
    clubCounts.set(player.club, (clubCounts.get(player.club) ?? 0) + 1);
  }

  for (const position of POSITION_ORDER) {
    if (positionCounts[position] !== SQUAD_POSITION_COUNTS[position]) {
      broken.push({
        code: POSITION_RULE_CODES[position],
        message: POSITION_RULE_MESSAGES[position],
      });
    }
  }

  for (const club of clubOrder) {
    if ((clubCounts.get(club) ?? 0) > CLUB_LIMIT) {
      broken.push({
        code: 'club_limit',
        message: `no more than 3 players may come from ${clubNames.get(club) ?? club}`,
      });
    }
  }

  if (overBudget) {
    broken.push({ code: 'budget', message: 'the squad costs more than the money available' });
  }

  if (positionMismatch) {
    broken.push({
      code: 'position_match',
      message: 'each player in must play the same position as the player out',
    });
  }

  return broken;
};
