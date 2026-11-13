import type {
  ChipCode,
  ChipState,
  EventType,
  ExcludingGoalkeeperPosition,
  GameweekStatus,
  LedgerKind,
  Position,
  RuleCode,
  RuleViolation,
  ShapeRuleCode,
} from '../shared/domain';
import {
  CAPTAIN_MULTIPLIER,
  CLUB_PER_SQUAD_LIMIT,
  ELEVEN_SIZE,
  FREE_TRANSFER_LIMIT,
  GAMEWEEK_COUNT,
  HIT_PER_TRANSFER,
  PRICE_MOVES_PER_GAMEWEEK,
  RULE_ORDER,
  SQUAD_POSITION_COUNTS,
  SQUAD_RULE_MESSAGES,
  SQUAD_SIZE,
  STARTING_POSITION_MINIMUMS,
  TRIPLE_CAPTAIN_MULTIPLIER,
  SHAPE_RULE_ORDER,
  SHAPE_RULE_MESSAGES,
} from '../shared/domain';

export interface PlayerCatalogueEntry {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export interface SquadPlayerState {
  id: string;
  club: string;
  position: Position;
  purchase_price_tenths: number;
  price_tenths: number;
}

export interface LineupSlot {
  player_id: string;
  position: Position;
}

export function sellingPriceTenths(purchaseTenths: number, priceTenths: number): number {
  if (priceTenths <= purchaseTenths) return priceTenths;
  const halfRiseTenths = Math.floor((priceTenths - purchaseTenths) / 2);
  return purchaseTenths + halfRiseTenths;
}

export interface SquadRuleInput {
  players: SquadPlayerState[];
  moneyAvailableTenths: number;
  costTenths: number;
  positionMatchPairs?: { out: Position; in: Position }[];
}

export function checkSquadRules(input: SquadRuleInput): RuleViolation[] {
  const ids = input.players.map((player) => player.id);
  const violations = new Map<RuleCode, RuleViolation>();
  const push = (code: RuleCode, message: string) => {
    if (!violations.has(code)) violations.set(code, { code, message });
  };

  if (ids.length !== SQUAD_SIZE) {
    push('squad_size', SQUAD_RULE_MESSAGES.squad_size);
  }

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) push('duplicate_player', SQUAD_RULE_MESSAGES.duplicate_player);
    seen.add(id);
  }

  for (const [position, required] of Object.entries(SQUAD_POSITION_COUNTS) as [Position, number][]) {
    const count = input.players.filter((player) => player.position === position).length;
    if (count !== required) {
      push(positionRuleCode(position), SQUAD_RULE_MESSAGES[positionRuleCode(position)]);
    }
  }

  const clubCounts = new Map<string, number>();
  for (const player of input.players) {
    clubCounts.set(player.club, (clubCounts.get(player.club) ?? 0) + 1);
  }
  const clubViolations: { code: RuleCode; message: string }[] = [];
  for (const [club, count] of clubCounts) {
    if (count > CLUB_PER_SQUAD_LIMIT) {
      clubViolations.push({ code: 'club_limit', message: `${SQUAD_RULE_MESSAGES.club_limit}${club}` });
    }
  }

  if (input.costTenths > input.moneyAvailableTenths) {
    push('budget', SQUAD_RULE_MESSAGES.budget);
  }

  if (input.positionMatchPairs !== undefined) {
    for (const pair of input.positionMatchPairs) {
      if (pair.out !== pair.in) push('position_match', SQUAD_RULE_MESSAGES.position_match);
    }
  }

  const result: RuleViolation[] = [];
  for (const code of RULE_ORDER) {
    const violation = violations.get(code);
    if (violation !== undefined) {
      if (code === 'duplicate_player') {
        const repeatIds = new Set<string>();
        const counted = new Set<string>();
        for (const id of ids) {
          if (counted.has(id)) repeatIds.add(id);
          counted.add(id);
        }
        for (const id of ids) {
          if (repeatIds.has(id)) {
            result.push({ code, message: SQUAD_RULE_MESSAGES.duplicate_player });
            repeatIds.delete(id);
          }
        }
      } else {
        result.push(violation);
      }
    }
    if (code === 'club_limit') {
      result.push(...clubViolations);
    }
  }
  return result;
}

function positionRuleCode(position: Position): RuleCode {
  switch (position) {
    case 'GK':
      return 'goalkeepers';
    case 'DEF':
      return 'defenders';
    case 'MID':
      return 'midfielders';
    case 'FWD':
      return 'forwards';
  }
}

export interface LineupState {
  starting: string[];
  bench: string[];
  captain: string | null;
  vice_captain: string | null;
}

export function checkShapeRules(
  starting: LineupSlot[],
  benchCount: number,
  captain: string | null,
  viceCaptain: string | null,
): RuleViolation[] {
  const violations = new Map<ShapeRuleCode, RuleViolation>();
  const push = (code: ShapeRuleCode, message: string) => {
    if (!violations.has(code)) violations.set(code, { code, message });
  };

  if (starting.length !== ELEVEN_SIZE || benchCount !== 4) {
    push('eleven_size', SHAPE_RULE_MESSAGES.eleven_size);
  }
  const counts = countByPosition(starting);
  if (counts.GK !== 1) push('shape_goalkeeper', SHAPE_RULE_MESSAGES.shape_goalkeeper);
  for (const position of ['DEF', 'MID', 'FWD'] as ExcludingGoalkeeperPosition[]) {
    if (counts[position] < STARTING_POSITION_MINIMUMS[position]) {
      push(shapeRuleCode(position), SHAPE_RULE_MESSAGES[shapeRuleCode(position)]);
    }
  }
  if (captain === null || viceCaptain === null || captain === viceCaptain || !starting.some((s) => s.player_id === captain) || !starting.some((s) => s.player_id === viceCaptain)) {
    push('captain', SHAPE_RULE_MESSAGES.captain);
  }

  const result: RuleViolation[] = [];
  for (const code of SHAPE_RULE_ORDER) {
    const violation = violations.get(code);
    if (violation !== undefined) result.push(violation);
  }
  return result;
}

function shapeRuleCode(position: ExcludingGoalkeeperPosition): ShapeRuleCode {
  switch (position) {
    case 'DEF':
      return 'shape_defenders';
    case 'MID':
      return 'shape_midfielders';
    case 'FWD':
      return 'shape_forwards';
  }
}

function countByPosition(slots: LineupSlot[]): Record<Position, number> {
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const slot of slots) counts[slot.position] += 1;
  return counts;
}

const POSITION_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function isElevenOrder(starting: LineupSlot[]): boolean {
  let last = -1;
  for (const slot of starting) {
    const order = POSITION_ORDER[slot.position];
    if (order < last) return false;
    last = order;
  }
  return true;
}

export function positionOf(id: string, players: Map<string, SquadPlayerState>): Position | null {
  const player = players.get(id);
  return player === undefined ? null : player.position;
}

export interface DefaultLineupResult {
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
}

export function defaultLineup(players: SquadPlayerState[]): DefaultLineupResult {
  const byId = new Map(players.map((player) => [player.id, player]));
  const sort = (a: string, b: string) => {
    const playerA = byId.get(a);
    const playerB = byId.get(b);
    const priceDiff = playerB!.price_tenths - playerA!.price_tenths;
    if (priceDiff !== 0) return priceDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  const goalkeepers = players.filter((p) => p.position === 'GK').map((p) => p.id).sort(sort);
  const defenders = players.filter((p) => p.position === 'DEF').map((p) => p.id).sort(sort);
  const midfielders = players.filter((p) => p.position === 'MID').map((p) => p.id).sort(sort);
  const forwards = players.filter((p) => p.position === 'FWD').map((p) => p.id).sort(sort);

  const starting = [goalkeepers[0], ...defenders.slice(0, 4), ...midfielders.slice(0, 4), ...forwards.slice(0, 2)];
  const bench = [goalkeepers[1], defenders[4], midfielders[4], forwards[2]];

  const ranked = starting.slice().sort(sort);
  return { starting, bench, captain: ranked[0], vice_captain: ranked[1] };
}

export function pairsOf(out: string[], into: string[]): { out: string; in: string }[] {
  const count = Math.min(out.length, into.length);
  const pairs: { out: string; in: string }[] = [];
  for (let i = 0; i < count; i += 1) pairs.push({ out: out[i], in: into[i] });
  return pairs;
}

export function hitPointsFor(count: number, freeTransfersHeld: number, activeChip: ChipCode | null): number {
  if (activeChip === 'wildcard' || activeChip === 'free_hit') return 0;
  const beyond = count - freeTransfersHeld;
  return beyond > 0 ? beyond * HIT_PER_TRANSFER : 0;
}

export function freeTransfersUsedFor(count: number, freeTransfersHeld: number, activeChip: ChipCode | null): number {
  if (activeChip === 'wildcard' || activeChip === 'free_hit') return 0;
  return Math.min(count, freeTransfersHeld);
}

export function freeTransfersAtDeadline(unusedThisGameweek: number): number {
  return Math.min(FREE_TRANSFER_LIMIT, unusedThisGameweek + 1);
}

export function seasonHalfOf(gameweek: number): 1 | 2 {
  return gameweek <= 18 ? 1 : 2;
}

export function chipStateFor(
  chip: ChipCode,
  gameweek: number,
  activeChip: ChipCode | null,
  usedThisHalf: Map<ChipCode, number>,
): ChipState {
  if (activeChip === chip && activeChip !== null) return 'active';
  return usedThisHalf.has(chip) && usedThisHalf.get(chip) === seasonHalfOf(gameweek) ? 'used' : 'available';
}

const SCORE_TABLE: Record<EventType, Record<Position, number>> = {
  minutes: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  assist: { GK: 3, DEF: 3, MID: 3, FWD: 3 },
  clean_sheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  yellow_card: { GK: -1, DEF: -1, MID: -1, FWD: -1 },
  red_card: { GK: -3, DEF: -3, MID: -3, FWD: -3 },
  own_goal: { GK: -2, DEF: -2, MID: -2, FWD: -2 },
  bonus: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
};

export function eventPoints(type: EventType, position: Position, value: number | null): number {
  switch (type) {
    case 'minutes':
      return value === null ? 0 : value >= 60 ? 2 : 1;
    case 'bonus':
      return value === null ? 0 : value;
    default:
      return SCORE_TABLE[type][position];
  }
}

export function multiplierFor(captain: boolean, tripleCaptain: boolean): number {
  if (captain && tripleCaptain) return TRIPLE_CAPTAIN_MULTIPLIER;
  if (captain) return CAPTAIN_MULTIPLIER;
  return 1;
}

export interface ScoringPlayer {
  id: string;
  position: Position;
  raw_points: number;
}

export interface ScoringLineup {
  starters: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
  bench_boost: boolean;
  triple_captain: boolean;
}

const POSITION_RANK: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function teamPointsFor(
  players: Map<string, ScoringPlayer>,
  lineup: ScoringLineup,
): { perPlayer: Map<string, number>; total: number } {
  const perPlayer = new Map<string, number>();
  const scoring = lineup.bench_boost ? [...lineup.starters, ...lineup.bench] : lineup.starters;
  let total = 0;
  for (const id of scoring) {
    const player = players.get(id);
    if (player === undefined) continue;
    const multiplier = id === lineup.captain ? multiplierFor(true, lineup.triple_captain) : multiplierFor(false, false);
    const contribution = player.raw_points * multiplier;
    perPlayer.set(id, contribution);
    total += contribution;
  }
  return { perPlayer, total };
}

export interface AutosubResult {
  subs: { out: string; in: string }[];
  captainFallbackTo: string | null;
}

export function applyAutosubs(
  starters: string[],
  bench: string[],
  captain: string,
  viceCaptain: string,
  players: Map<string, Pick<SquadPlayerState, 'position'>>,
  played: Set<string>,
  benchBoost: boolean,
): AutosubResult {
  if (benchBoost) return { subs: [], captainFallbackTo: null };
  const used = new Set<string>();
  const subs: { out: string; in: string }[] = [];
  const positionOf = (id: string): Position => players.get(id)?.position ?? 'GK';

  const current: LineupSlot[] = starters.map((id) => ({ player_id: id, position: positionOf(id) }));
  for (let i = 0; i < current.length; i += 1) {
    if (played.has(current[i].player_id)) continue;
    const replacement = bench.find((id) => {
      if (used.has(id) || !played.has(id)) return false;
      const trial = current.map((slot, slotIndex) =>
        slotIndex === i ? { player_id: id, position: positionOf(id) } : slot,
      );
      return checkShapeRules(trial, 4, captain, viceCaptain).every((rule) => rule.code === 'captain');
    });
    if (replacement === undefined) continue;
    used.add(replacement);
    current[i] = { player_id: replacement, position: positionOf(replacement) };
    subs.push({ out: starters[i], in: replacement });
  }

  let fallback: string | null = null;
  if (!played.has(captain) && played.has(viceCaptain)) {
    fallback = viceCaptain;
  }
  return { subs, captainFallbackTo: fallback };
}

export function priceMoveAllowed(movesSinceGameweekOpen: number): boolean {
  return movesSinceGameweekOpen < PRICE_MOVES_PER_GAMEWEEK;
}

export function isLegalTransition(from: GameweekStatus, to: GameweekStatus): boolean {
  if (from === 'upcoming' && to === 'open') return true;
  if (from === 'open' && to === 'locked') return true;
  if (from === 'locked' && to === 'live') return true;
  if (from === 'live' && to === 'closed') return true;
  return false;
}

export interface StandingEntry {
  manager_id: string;
  team_name: string;
  season_total: number;
  last_total: number | null;
}

export function orderStandings(entries: StandingEntry[]): { ranked: StandingEntry[]; lastRankOf: Map<string, number | null> } {
  const sorted = entries.slice().sort((a, b) => {
    if (b.season_total !== a.season_total) return b.season_total - a.season_total;
    const nameA = a.team_name.toLowerCase();
    const nameB = b.team_name.toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.manager_id < b.manager_id ? -1 : a.manager_id > b.manager_id ? 1 : 0;
  });
  const lastSorted = entries.slice().sort((a, b) => {
    if ((b.last_total ?? -Infinity) !== (a.last_total ?? -Infinity)) return (b.last_total ?? -Infinity) - (a.last_total ?? -Infinity);
    const nameA = a.team_name.toLowerCase();
    const nameB = b.team_name.toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.manager_id < b.manager_id ? -1 : a.manager_id > b.manager_id ? 1 : 0;
  });
  const lastRankOf = new Map<string, number | null>();
  lastSorted.forEach((entry, index) => {
    lastRankOf.set(entry.manager_id, entry.last_total === null ? null : index + 1);
  });
  return { ranked: sorted, lastRankOf };
}

export const MAX_GAMEWEEK = GAMEWEEK_COUNT;
