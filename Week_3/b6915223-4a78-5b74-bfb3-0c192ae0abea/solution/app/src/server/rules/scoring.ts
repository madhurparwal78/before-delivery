import type { ChipCode, EventType, Position } from "../../shared/api.ts";
import { shapeHolds } from "./eleven.ts";

// Scoring, team points, auto-subs and captain fallback (brief: Business rules / Scoring, Close).

const GOAL: Record<Position, number> = { GK: 6, DEF: 6, MID: 5, FWD: 4 };
const CLEAN_SHEET: Record<Position, number> = { GK: 4, DEF: 4, MID: 1, FWD: 0 };

export function appearancePoints(minutes: number): number {
  if (minutes >= 60) return 2;
  return minutes >= 1 ? 1 : 0;
}

// Points of every event type except minutes, whose points depend on the fixture's largest value.
export function eventPoints(type: Exclude<EventType, "minutes">, position: Position, value: number | null): number {
  switch (type) {
    case "goal":
      return GOAL[position];
    case "assist":
      return 3;
    case "clean_sheet":
      return CLEAN_SHEET[position];
    case "yellow_card":
      return -1;
    case "red_card":
      return -3;
    case "own_goal":
      return -2;
    case "bonus":
      return value!;
  }
}

export interface CountedEvent {
  player_id: string;
  fixture_id: string;
  type: EventType;
  value: number | null;
}

// Raw points per player over non-voided events.
export function rawPoints(events: readonly CountedEvent[], positionOf: (playerId: string) => Position): Map<string, number> {
  const minutes = new Map<string, { player: string; most: number }>();
  const points = new Map<string, number>();
  const add = (player: string, delta: number) => points.set(player, (points.get(player) ?? 0) + delta);
  for (const event of events) {
    if (event.type === "minutes") {
      const key = `${event.player_id}|${event.fixture_id}`;
      const most = Math.max(minutes.get(key)?.most ?? 0, event.value!);
      minutes.set(key, { player: event.player_id, most });
    } else {
      add(event.player_id, eventPoints(event.type, positionOf(event.player_id), event.value));
    }
  }
  for (const { player, most } of minutes.values()) add(player, appearancePoints(most));
  return points;
}

export function playedPlayers(events: readonly CountedEvent[]): Set<string> {
  return new Set(events.filter((event) => event.type === "minutes" && event.value! >= 1).map((event) => event.player_id));
}

export interface LockedTeam {
  starting: readonly string[];
  bench: readonly string[];
  captain: string;
  vice_captain: string;
  chip: ChipCode | null;
}

const multiplier = (chip: ChipCode | null) => (chip === "triple_captain" ? 3 : 2);

// While a gameweek is live: starters count, the captain counts two or three times, the bench only under Bench Boost.
export function liveTeamPoints(team: LockedTeam, raw: ReadonlyMap<string, number>): Map<string, number> {
  const points = new Map<string, number>();
  for (const id of team.starting) points.set(id, (raw.get(id) ?? 0) * (id === team.captain ? multiplier(team.chip) : 1));
  for (const id of team.bench) points.set(id, team.chip === "bench_boost" ? raw.get(id) ?? 0 : 0);
  return points;
}

interface ClosedScore {
  points: number;
  substitutions: { in: string; out: string }[];
  armbandFallback: string | null;
}

export function closedTeamScore(
  team: LockedTeam,
  raw: ReadonlyMap<string, number>,
  played: ReadonlySet<string>,
  positionOf: (playerId: string) => Position,
): ClosedScore {
  const eleven = [...team.starting];
  const substitutions: { in: string; out: string }[] = [];
  if (team.chip !== "bench_boost") {
    const used = new Set<string>();
    for (const starter of team.starting) {
      if (played.has(starter)) continue;
      const index = eleven.indexOf(starter);
      const replacement = team.bench.find((candidate) => {
        if (!played.has(candidate) || used.has(candidate)) return false;
        const trial = eleven.map((id, i) => (i === index ? candidate : id));
        return shapeHolds(trial.map((id) => ({ id, position: positionOf(id) })));
      });
      if (replacement) {
        eleven[index] = replacement;
        used.add(replacement);
        substitutions.push({ in: replacement, out: starter });
      }
    }
  }
  let armband: string | null = null;
  let armbandFallback: string | null = null;
  if (played.has(team.captain)) armband = team.captain;
  else if (played.has(team.vice_captain)) armband = armbandFallback = team.vice_captain;
  const counted = team.chip === "bench_boost" ? [...team.starting, ...team.bench] : eleven;
  let points = counted.reduce((sum, id) => sum + (raw.get(id) ?? 0), 0);
  if (armband) points += (multiplier(team.chip) - 1) * (raw.get(armband) ?? 0);
  return { points, substitutions, armbandFallback };
}
