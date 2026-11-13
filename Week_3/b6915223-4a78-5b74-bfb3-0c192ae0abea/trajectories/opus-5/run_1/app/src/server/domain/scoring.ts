import type { EventType, Position } from '../../shared/types.ts';

export const EVENT_TYPES: EventType[] = [
  'minutes',
  'goal',
  'assist',
  'clean_sheet',
  'yellow_card',
  'red_card',
  'own_goal',
  'bonus',
];

export const EVENT_NEEDS_VALUE: Partial<Record<EventType, { min: number; max: number }>> = {
  minutes: { min: 1, max: 120 },
  bonus: { min: 1, max: 3 },
};

const FIXED_POINTS: Record<
  Exclude<EventType, 'minutes' | 'bonus'>,
  Record<Position, number>
> = {
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  assist: { GK: 3, DEF: 3, MID: 3, FWD: 3 },
  clean_sheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  yellow_card: { GK: -1, DEF: -1, MID: -1, FWD: -1 },
  red_card: { GK: -3, DEF: -3, MID: -3, FWD: -3 },
  own_goal: { GK: -2, DEF: -2, MID: -2, FWD: -2 },
};

export const appearancePoints = (minutes: number): number => {
  if (minutes <= 0) return 0;
  return minutes >= 60 ? 2 : 1;
};

/** The one place the scoring table is applied. */
export const eventPoints = (
  type: EventType,
  value: number | null,
  position: Position,
): number => {
  if (type === 'minutes') return appearancePoints(value ?? 0);
  if (type === 'bonus') return value ?? 0;
  return FIXED_POINTS[type][position];
};

export interface ScoredEvent {
  fixture_id: string;
  type: EventType;
  value: number | null;
  voided: boolean;
}

/** A player's raw points for one gameweek, from their non-voided events. */
export const rawPoints = (events: ScoredEvent[], position: Position): number => {
  let total = 0;
  const bestMinutes = new Map<string, number>();
  for (const event of events) {
    if (event.voided) continue;
    if (event.type === 'minutes') {
      const minutes = event.value ?? 0;
      bestMinutes.set(event.fixture_id, Math.max(bestMinutes.get(event.fixture_id) ?? 0, minutes));
      continue;
    }
    total += eventPoints(event.type, event.value, position);
  }
  for (const minutes of bestMinutes.values()) total += appearancePoints(minutes);
  return total;
};

export const playedInGameweek = (events: ScoredEvent[]): boolean =>
  events.some((event) => !event.voided && event.type === 'minutes' && (event.value ?? 0) >= 1);

export interface MultiplierInput {
  slot: 'starting' | 'bench';
  captain: boolean;
  chip: 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain' | null;
}

/** The one place a player's team multiplier is decided. */
export const teamMultiplier = (input: MultiplierInput): number => {
  if (input.slot === 'bench') return input.chip === 'bench_boost' ? 1 : 0;
  if (input.captain) return input.chip === 'triple_captain' ? 3 : 2;
  return 1;
};
