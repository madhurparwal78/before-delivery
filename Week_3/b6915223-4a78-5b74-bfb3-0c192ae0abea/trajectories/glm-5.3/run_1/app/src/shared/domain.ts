export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export const POSITIONS: readonly Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export const POSITION_LABELS: Record<Position, string> = {
  GK: 'goalkeeper',
  DEF: 'defender',
  MID: 'midfielder',
  FWD: 'forward',
};

export const SQUAD_POSITION_COUNTS: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

export const STARTING_POSITION_MINIMUMS: Record<ExcludingGoalkeeperPosition, number> = { DEF: 3, MID: 2, FWD: 1 };

export type ExcludingGoalkeeperPosition = Exclude<Position, 'GK'>;

export type ChipCode = 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain';

export const CHIP_CODES: readonly ChipCode[] = ['wildcard', 'free_hit', 'bench_boost', 'triple_captain'];

export const CHIP_NAMES: Record<ChipCode, string> = {
  wildcard: 'Wildcard',
  free_hit: 'Free Hit',
  bench_boost: 'Bench Boost',
  triple_captain: 'Triple Captain',
};

export const CHIP_DESCRIPTIONS: Record<ChipCode, string> = {
  wildcard: 'This gameweek’s transfers are free and permanent.',
  free_hit: 'This gameweek’s transfers are free and are reverted when the gameweek closes.',
  bench_boost: 'All fifteen players score points this gameweek.',
  triple_captain: 'The captain scores triple, not double, this gameweek.',
};

export const CHIP_CANCEL_MESSAGES: Record<ChipCode, string> = {
  wildcard: 'Wildcard cannot be cancelled once played.',
  free_hit: 'Free Hit cannot be cancelled once played.',
  bench_boost: 'Bench Boost cancelled.',
  triple_captain: 'Triple Captain cancelled.',
};

export type ChipState = 'available' | 'active' | 'used';

export type GameweekStatus = 'upcoming' | 'open' | 'locked' | 'live' | 'closed';

export const GAMEWEEK_COUNT = 36;

export const SEASON_FIRST_HALF_END = 18;

export const TOTAL_GAMEWEEKS = 36;

export const OPENING_BUDGET_TENTHS = 1000;

export const FREE_TRANSFER_LIMIT = 5;

export const HIT_PER_TRANSFER = 4;

export const CAPTAIN_MULTIPLIER = 2;

export const TRIPLE_CAPTAIN_MULTIPLIER = 3;

export const SQUAD_SIZE = 15;

export const ELEVEN_SIZE = 11;

export const BENCH_SIZE = 4;

export const CLUB_PER_SQUAD_LIMIT = 3;

export const PRICE_MOVES_PER_GAMEWEEK = 3;

export type EventType = 'minutes' | 'goal' | 'assist' | 'clean_sheet' | 'yellow_card' | 'red_card' | 'own_goal' | 'bonus';

export const EVENT_TYPES: readonly EventType[] = [
  'minutes',
  'goal',
  'assist',
  'clean_sheet',
  'yellow_card',
  'red_card',
  'own_goal',
  'bonus',
];

export const EVENT_LABELS: Record<EventType, string> = {
  minutes: 'minutes played',
  goal: 'goal',
  assist: 'assist',
  clean_sheet: 'clean sheet',
  yellow_card: 'yellow card',
  red_card: 'red card',
  own_goal: 'own goal',
  bonus: 'bonus',
};

export const MAX_REQUEST_BYTES = 65536;

export type RuleCode =
  | 'squad_size'
  | 'duplicate_player'
  | 'goalkeepers'
  | 'defenders'
  | 'midfielders'
  | 'forwards'
  | 'club_limit'
  | 'budget'
  | 'position_match';

export type ShapeRuleCode =
  | 'eleven_size'
  | 'shape_goalkeeper'
  | 'shape_defenders'
  | 'shape_midfielders'
  | 'shape_forwards'
  | 'captain';

export const SQUAD_RULE_MESSAGES: Record<RuleCode, string> = {
  squad_size: 'the squad needs exactly 15 players',
  duplicate_player: 'a player can only be picked once',
  goalkeepers: 'the squad needs exactly 2 goalkeepers',
  defenders: 'the squad needs exactly 5 defenders',
  midfielders: 'the squad needs exactly 5 midfielders',
  forwards: 'the squad needs exactly 3 forwards',
  club_limit: 'no more than 3 players may come from ',
  budget: 'the squad costs more than the money available',
  position_match: 'each player in must play the same position as the player out',
};

export const SHAPE_RULE_MESSAGES: Record<ShapeRuleCode, string> = {
  eleven_size: 'the eleven needs exactly 11 players and the bench 4',
  shape_goalkeeper: 'the eleven needs exactly 1 goalkeeper',
  shape_defenders: 'the eleven needs at least 3 defenders',
  shape_midfielders: 'the eleven needs at least 2 midfielders',
  shape_forwards: 'the eleven needs at least 1 forward',
  captain: 'the captain and vice-captain must be two different starters',
};

export const RULE_ORDER: readonly RuleCode[] = [
  'squad_size',
  'duplicate_player',
  'goalkeepers',
  'defenders',
  'midfielders',
  'forwards',
  'club_limit',
  'budget',
  'position_match',
];

export const SHAPE_RULE_ORDER: readonly ShapeRuleCode[] = [
  'eleven_size',
  'shape_goalkeeper',
  'shape_defenders',
  'shape_midfielders',
  'shape_forwards',
  'captain',
];

export type LedgerKind = 'opening_budget' | 'purchase' | 'sale' | 'reversal';

export type ReceiptState = 'stored' | 'pending';

export interface RuleViolation {
  code: RuleCode | ShapeRuleCode;
  message: string;
}
