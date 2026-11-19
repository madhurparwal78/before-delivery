import {
  CLASS_PI, carModel, type CarClass, type LayoutId, type Mode, type Stages, tunedPi,
} from "../shared/model.js";
import { LEAGUE_TARGET } from "../shared/rules.js";
import type { Database, Transaction } from "./db.js";
import { addMovement } from "./ledger.js";
import { Hub } from "./push.js";

type LeagueId = "rookie" | "club";

interface ChampionshipEvent {
  readonly eventId: string;
  readonly name: string;
  readonly league: LeagueId | null;
  readonly mode: Mode;
  readonly layoutId: LayoutId;
  readonly class: CarClass | null;
  readonly laps: number;
  readonly aiCarId: string | null;
}

export const EVENTS: readonly ChampionshipEvent[] = [
  { eventId: "rookie-circuit", name: "Rookie Circuit", league: "rookie", mode: "circuit", layoutId: "saltflat-ring", class: "D", laps: 3, aiCarId: "kestrel-hatch" },
  { eventId: "rookie-drift", name: "Rookie Drift", league: "rookie", mode: "drift", layoutId: "saltflat-ring", class: "D", laps: 1, aiCarId: null },
  { eventId: "rookie-time-trial", name: "Rookie Time Trial", league: "rookie", mode: "time-trial", layoutId: "saltflat-ring", class: "D", laps: 3, aiCarId: null },
  { eventId: "club-circuit", name: "Club Circuit", league: "club", mode: "circuit", layoutId: "quarry-switchbacks", class: "C", laps: 3, aiCarId: "halcyon-rs" },
  { eventId: "club-time-trial", name: "Club Time Trial", league: "club", mode: "time-trial", layoutId: "quarry-switchbacks", class: "C", laps: 3, aiCarId: null },
  { eventId: "guided-first-race", name: "Guided first race", league: null, mode: "practice", layoutId: "saltflat-ring", class: null, laps: 1, aiCarId: null },
];

const FINALS_COINS = 1000;
const LOANER_CARS: Readonly<Partial<Record<CarClass, string>>> = { D: "kestrel-hatch", C: "halcyon-rs" };
const EVENT_PLACING_POINTS: Readonly<Record<number, number>> = { 1: 25, 2: 18, 3: 15 };
const EVENT_DRIFT_DIVISOR = 1000;
const EVENT_MAX_POINTS = 25;
const TIME_TRIAL_TARGET_MS = 60000;
const TIME_TRIAL_SLOW_POINTS = 10;

export function eventById(eventId: string): ChampionshipEvent | undefined {
  return EVENTS.find((event) => event.eventId === eventId);
}

interface EventOutcome {
  readonly position: number | null;
  readonly driftScore: number;
  readonly validLapsMs: readonly number[];
}

// Points one verified event run scores.
export function eventPoints(event: ChampionshipEvent, outcome: EventOutcome): number {
  if (event.mode === "circuit") return EVENT_PLACING_POINTS[outcome.position ?? 0] ?? 0;
  if (event.mode === "drift") return Math.min(Math.floor(outcome.driftScore / EVENT_DRIFT_DIVISOR), EVENT_MAX_POINTS);
  return outcome.validLapsMs.some((ms) => ms <= TIME_TRIAL_TARGET_MS) ? EVENT_MAX_POINTS : TIME_TRIAL_SLOW_POINTS;
}

// Eligibility: the car's catalogue class equals the event's class and its PI is within that class.
export function eligible(event: ChampionshipEvent, carId: string, stages: Stages): boolean {
  if (!event.class) return true;
  const model = carModel(carId)!;
  return model.class === event.class && tunedPi(model.pi, stages) <= CLASS_PI[event.class].max;
}

interface OwnedCar {
  readonly carId: string;
  readonly stages: Stages;
}

// The loaner an event offers this player, or null when it offers none.
export function offeredLoaner(event: ChampionshipEvent, owned: readonly OwnedCar[]): string | null {
  if (!event.class) return null;
  if (owned.some((car) => eligible(event, car.carId, car.stages))) return null;
  return LOANER_CARS[event.class] ?? null;
}

interface Standing {
  readonly rookieComplete: boolean;
  readonly clubComplete: boolean;
  readonly trophy: boolean;
}

export function leagueOpen(league: LeagueId | null, standing: Standing): boolean {
  return league !== "club" || standing.rookieComplete;
}

export function layoutOpen(layoutId: LayoutId, standing: Standing): boolean {
  return layoutId !== "quarry-switchbacks" || standing.rookieComplete;
}

export interface Championship {
  leagues: {
    leagueId: LeagueId;
    status: "locked" | "open" | "complete";
    points: number;
    events: {
      eventId: string; name: string; mode: Mode; layoutId: LayoutId; class: CarClass | null;
      points: number; eligible: boolean; loanerCarId: string | null;
    }[];
  }[];
  trophy: boolean;
}

export async function loadOwned(db: Database | Transaction, playerId: string): Promise<OwnedCar[]> {
  const rows = await db.query<{ car_id: string; engine: number; tires: number; brakes: number; suspension: number }>(
    "SELECT car_id, engine, tires, brakes, suspension FROM owned_cars WHERE player_id = $1 ORDER BY acquired_at", [playerId]);
  return rows.map((row) => ({
    carId: row.car_id,
    stages: { engine: row.engine, tires: row.tires, brakes: row.brakes, suspension: row.suspension },
  }));
}

export async function loadStanding(db: Database | Transaction, playerId: string): Promise<Standing> {
  const [row] = await db.query<{ rookie_complete: boolean; club_complete: boolean; trophy: boolean }>(
    "SELECT rookie_complete, club_complete, trophy FROM players WHERE id = $1", [playerId]);
  return { rookieComplete: row.rookie_complete, clubComplete: row.club_complete, trophy: row.trophy };
}

export async function championship(db: Database | Transaction, playerId: string): Promise<Championship> {
  const standing = await loadStanding(db, playerId);
  const owned = await loadOwned(db, playerId);
  const points = new Map((await db.query<{ event_id: string; points: number }>(
    "SELECT event_id, points FROM event_points WHERE player_id = $1", [playerId])).map((row) => [row.event_id, row.points]));
  const leagues = (["rookie", "club"] as const).map((leagueId) => {
    const events = EVENTS.filter((event) => event.league === leagueId).map((event) => ({
      eventId: event.eventId, name: event.name, mode: event.mode, layoutId: event.layoutId, class: event.class,
      points: points.get(event.eventId) ?? 0,
      eligible: owned.some((car) => eligible(event, car.carId, car.stages)),
      loanerCarId: offeredLoaner(event, owned),
    }));
    const complete = leagueId === "rookie" ? standing.rookieComplete : standing.clubComplete;
    const status: "locked" | "open" | "complete" = complete ? "complete" : leagueOpen(leagueId, standing) ? "open" : "locked";
    return { leagueId, status, points: events.reduce((sum, event) => sum + event.points, 0), events };
  });
  return { leagues, trophy: standing.trophy };
}

// Records a verified event run's points (the event keeps its best), then completes leagues:
// Rookie completion and the Club + Quarry Switchbacks unlock in this commit; Club completion,
// the trophy and the single finals movement in this commit. Runs inside Database.withPlayer.
export async function recordEventPoints(tx: Transaction, playerId: string, event: ChampionshipEvent, points: number): Promise<void> {
  const [kept] = await tx.query<{ points: number }>(
    `INSERT INTO event_points (player_id, event_id, points) VALUES ($1,$2,$3)
     ON CONFLICT (player_id, event_id) DO UPDATE SET points = GREATEST(event_points.points, EXCLUDED.points)
     RETURNING points`, [playerId, event.eventId, points]);
  const before = await loadStanding(tx, playerId);
  const totals = new Map((await tx.query<{ league: LeagueId; total: number }>(
    `SELECT e.league, COALESCE(SUM(p.points), 0)::int AS total FROM event_points p JOIN events e ON e.event_id = p.event_id
      WHERE p.player_id = $1 GROUP BY e.league`, [playerId])).map((row) => [row.league, row.total]));
  let changed = kept.points === points;
  if (!before.rookieComplete && (totals.get("rookie") ?? 0) >= LEAGUE_TARGET) {
    await tx.query("UPDATE players SET rookie_complete = true WHERE id = $1", [playerId]);
    changed = true;
  }
  if (before.rookieComplete && !before.clubComplete && (totals.get("club") ?? 0) >= LEAGUE_TARGET) {
    await tx.query("UPDATE players SET club_complete = true, trophy = true WHERE id = $1", [playerId]);
    await addMovement(tx, { playerId, kind: "finals", amount: FINALS_COINS });
    changed = true;
  }
  if (changed) await Hub.queue(tx, { to: playerId, push: { type: "championship", ...(await championship(tx, playerId)) } });
}
