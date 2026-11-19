import {
  EVENTS,
  LEAGUE_IDS,
  LEAGUE_TARGET_POINTS,
  FINALS_REWARD_COINS,
  type CarClass,
  type LeagueId,
  LOANER_CAR_BY_CLASS,
  isEligible,
  type StageMap,
} from '../shared/catalogue.js';
import type { Queryable } from './db.js';
import { one } from './db.js';
import { writeMovement } from './ledger.js';
import { pushToPlayer } from './pushes.js';
import { ownedCars } from './garage.js';

export interface EventBody {
  eventId: string;
  name: string;
  mode: string;
  layoutId: string;
  class: CarClass;
  points: number;
  eligible: boolean;
  loanerCarId: string | null;
}

export interface LeagueBody {
  leagueId: LeagueId;
  status: 'locked' | 'open' | 'complete';
  points: number;
  events: EventBody[];
}

export interface ChampionshipBody {
  leagues: LeagueBody[];
  trophy: boolean;
}

export async function leagueCompleted(
  tx: Queryable,
  playerId: string,
  leagueId: LeagueId,
): Promise<boolean> {
  const row = await one<{ league_id: string }>(
    tx,
    'select league_id from league_state where player_id = $1 and league_id = $2',
    [playerId, leagueId],
  );
  return row !== null;
}

/** Quarry Switchbacks is unlocked for every mode once the Rookie league is complete. */
export async function quarryUnlocked(tx: Queryable, playerId: string): Promise<boolean> {
  return await leagueCompleted(tx, playerId, 'rookie');
}

async function eventPoints(tx: Queryable, playerId: string): Promise<Map<string, number>> {
  const { rows } = await tx.query<{ event_id: string; points: number }>(
    'select event_id, points from event_points where player_id = $1',
    [playerId],
  );
  return new Map(rows.map((row) => [row.event_id, row.points]));
}

export function ownsEligibleCar(
  cars: { carId: string; stages: StageMap }[],
  eventClass: CarClass,
): boolean {
  return cars.some((car) => isEligible(car.carId, car.stages, eventClass));
}

export async function championshipBody(
  tx: Queryable,
  playerId: string,
): Promise<ChampionshipBody> {
  const points = await eventPoints(tx, playerId);
  const cars = await ownedCars(tx, playerId);
  const trophyRow = await one<{ trophy: boolean }>(
    tx,
    'select trophy from players where player_id = $1',
    [playerId],
  );
  const rookieComplete = await leagueCompleted(tx, playerId, 'rookie');
  const clubComplete = await leagueCompleted(tx, playerId, 'club');

  const leagues: LeagueBody[] = LEAGUE_IDS.map((leagueId) => {
    const events = EVENTS.filter((event) => event.leagueId === leagueId).map((event) => {
      const eventClass = event.class!;
      const eligible = ownsEligibleCar(cars, eventClass);
      return {
        eventId: event.eventId,
        name: event.name,
        mode: event.mode,
        layoutId: event.layoutId,
        class: eventClass,
        points: points.get(event.eventId) ?? 0,
        eligible,
        loanerCarId: eligible ? null : LOANER_CAR_BY_CLASS[eventClass],
      };
    });
    const total = events.reduce((sum, event) => sum + event.points, 0);
    const complete = leagueId === 'rookie' ? rookieComplete : clubComplete;
    const status: LeagueBody['status'] = complete
      ? 'complete'
      : leagueId === 'club' && !rookieComplete
        ? 'locked'
        : 'open';
    return { leagueId, status, points: total, events };
  });

  return { leagues, trophy: trophyRow?.trophy ?? false };
}

/**
 * Keeps the player's best points for an event, then completes leagues, writes unlocks
 * and pays the finals reward exactly once. Runs inside the per-player lock.
 */
export async function recordEventPoints(
  tx: Queryable,
  playerId: string,
  eventId: string,
  points: number,
): Promise<void> {
  await tx.query(
    `insert into event_points (player_id, event_id, points)
     values ($1, $2, $3)
     on conflict (player_id, event_id) do update set points = greatest(event_points.points, excluded.points)`,
    [playerId, eventId, points],
  );
  const totals = await eventPoints(tx, playerId);
  for (const leagueId of LEAGUE_IDS) {
    const total = EVENTS.filter((event) => event.leagueId === leagueId).reduce(
      (sum, event) => sum + (totals.get(event.eventId) ?? 0),
      0,
    );
    if (total < LEAGUE_TARGET_POINTS) continue;
    const inserted = await one<{ league_id: string }>(
      tx,
      `insert into league_state (player_id, league_id) values ($1, $2)
       on conflict (player_id, league_id) do nothing returning league_id`,
      [playerId, leagueId],
    );
    if (!inserted) continue;
    if (leagueId === 'club') {
      await tx.query('update players set trophy = true where player_id = $1', [playerId]);
      await writeMovement(tx, {
        playerId,
        kind: 'finals',
        amount: FINALS_REWARD_COINS,
      });
    }
  }
}

export async function pushChampionship(tx: Queryable, playerId: string): Promise<void> {
  const body = await championshipBody(tx, playerId);
  pushToPlayer(playerId, { type: 'championship', ...body });
}
