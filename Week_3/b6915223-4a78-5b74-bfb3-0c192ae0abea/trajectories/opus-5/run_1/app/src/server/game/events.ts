import { createHash } from 'node:crypto';
import { one, pool, query } from '../db.ts';
import type { EventType, MatchEvent, Position } from '../../shared/types.ts';
import {
  EVENT_NEEDS_VALUE,
  EVENT_TYPES,
  rawPoints,
  teamMultiplier,
  type ScoredEvent,
} from '../domain/scoring.ts';
import { broadcastExcept, sendTo } from '../services/realtime.ts';
import { currentGameweek, effectiveStatus, gameweekByNumber } from './gameweeks.ts';
import { squadView } from './squad.ts';
import { conflict, notFound, validation } from '../http/errors.ts';

export const bodyHash = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface StoredEvent {
  event_id: string;
  gameweek: number;
  fixture_id: string;
  player_id: string;
  type: EventType;
  value: number | null;
  voided: boolean;
  body_hash: string;
  response_body: MatchEvent;
}

export interface EventRequest {
  event_id: string;
  fixture_id: string;
  player_id: string;
  type: EventType;
  value: number | null;
}

export const parseEventRequest = (body: Record<string, unknown>): EventRequest => {
  const fields: Record<string, string> = {};
  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  if (!EVENT_ID_PATTERN.test(eventId)) {
    fields.event_id = 'Use 1 to 64 letters, digits, hyphens or underscores.';
  }
  const fixtureId = typeof body.fixture_id === 'string' ? body.fixture_id : '';
  if (fixtureId === '') fields.fixture_id = 'Choose a fixture.';
  const playerId = typeof body.player_id === 'string' ? body.player_id : '';
  if (playerId === '') fields.player_id = 'Choose a player.';
  const type = EVENT_TYPES.find((candidate) => candidate === body.type);
  if (type === undefined) fields.type = 'Choose an event type.';
  let value: number | null = null;
  if (type !== undefined) {
    const bounds = EVENT_NEEDS_VALUE[type];
    if (bounds === undefined) {
      if (body.value !== undefined && body.value !== null) {
        fields.value = 'This event takes no value.';
      }
    } else if (
      typeof body.value !== 'number' ||
      !Number.isInteger(body.value) ||
      body.value < bounds.min ||
      body.value > bounds.max
    ) {
      fields.value = `Give a whole number from ${bounds.min} to ${bounds.max}.`;
    } else {
      value = body.value;
    }
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { event_id: eventId, fixture_id: fixtureId, player_id: playerId, type: type!, value };
};

const eventsForPlayer = (gameweek: number, playerId: string): Promise<ScoredEvent[]> =>
  query<ScoredEvent>(
    pool,
    `select fixture_id, type, value, voided from match_events
      where gameweek = $1 and player_id = $2`,
    [gameweek, playerId],
  );

const relay = async (
  playerId: string,
  playerName: string,
  eventId: string,
  eventType: EventType,
  voided: boolean,
  rawDelta: number,
): Promise<void> => {
  if (rawDelta === 0) return;
  const owners = await query<{ manager_id: string }>(
    pool,
    'select manager_id from squad_players where player_id = $1',
    [playerId],
  );
  const ownerIds = new Set(owners.map((owner) => owner.manager_id));
  for (const owner of owners) {
    const view = await squadView(owner.manager_id);
    const player = view.players.find((entry) => entry.id === playerId)!;
    const multiplier = teamMultiplier({
      slot: player.slot,
      captain: player.captain,
      chip: view.chip,
    });
    sendTo(owner.manager_id, {
      type: 'points',
      event_id: eventId,
      player_id: playerId,
      player_name: playerName,
      event_type: eventType,
      voided,
      counts: multiplier > 0,
      team_delta: rawDelta * multiplier,
      player_team_points: player.team_points,
      gameweek_total: view.gameweek_total,
      multiplier,
    });
  }
  broadcastExcept(ownerIds, { type: 'standings' });
};

export const recordEvent = async (
  request: EventRequest,
  hash: string,
): Promise<{ status: number; body: MatchEvent; replayed: boolean }> => {
  const stored = await one<StoredEvent>(
    pool,
    `select event_id, gameweek, fixture_id, player_id, type, value, voided, body_hash, response_body
       from match_events where event_id = $1`,
    [request.event_id],
  );
  if (stored !== undefined) {
    if (stored.body_hash !== hash) {
      throw conflict(
        'event_id_conflict',
        'That event id was already used for a different event.',
      );
    }
    return { status: 201, body: stored.response_body, replayed: true };
  }

  const fixture = await one<{ gameweek: number; home: string; away: string }>(
    pool,
    'select gameweek, home, away from fixtures where id = $1',
    [request.fixture_id],
  );
  const player = await one<{ name: string; club: string; position: Position }>(
    pool,
    'select name, club, position from players where id = $1',
    [request.player_id],
  );

  if (fixture !== undefined) {
    const gameweek = (await gameweekByNumber(fixture.gameweek))!;
    if (effectiveStatus(gameweek, new Date()) !== 'live') {
      throw conflict('gameweek_not_live', `Gameweek ${gameweek.number} is not live.`);
    }
  }

  const fields: Record<string, string> = {};
  if (fixture === undefined) fields.fixture_id = 'Unknown fixture.';
  if (player === undefined) fields.player_id = 'Unknown player.';
  if (
    fixture !== undefined &&
    player !== undefined &&
    player.club !== fixture.home &&
    player.club !== fixture.away
  ) {
    fields.player_id = 'That player does not play in this fixture.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const before = await eventsForPlayer(fixture!.gameweek, request.player_id);
  const rawBefore = rawPoints(before, player!.position);
  const rawAfter = rawPoints(
    [
      ...before,
      {
        fixture_id: request.fixture_id,
        type: request.type,
        value: request.value,
        voided: false,
      },
    ],
    player!.position,
  );

  const recordedAt = new Date().toISOString();
  const body: MatchEvent = {
    event_id: request.event_id,
    gameweek: fixture!.gameweek,
    fixture_id: request.fixture_id,
    player_id: request.player_id,
    type: request.type,
    value: request.value,
    points_delta: rawAfter - rawBefore,
    voided: false,
    recorded_at: recordedAt,
  };

  const inserted = await query<{ event_id: string }>(
    pool,
    `insert into match_events
       (event_id, gameweek, fixture_id, player_id, type, value, recorded_at, body_hash, response_body)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (event_id) do nothing
     returning event_id`,
    [
      request.event_id,
      fixture!.gameweek,
      request.fixture_id,
      request.player_id,
      request.type,
      request.value,
      recordedAt,
      hash,
      JSON.stringify(body),
    ],
  );
  if (inserted.length === 0) {
    const raced = (await one<StoredEvent>(
      pool,
      'select body_hash, response_body from match_events where event_id = $1',
      [request.event_id],
    ))!;
    if (raced.body_hash !== hash) {
      throw conflict(
        'event_id_conflict',
        'That event id was already used for a different event.',
      );
    }
    return { status: 201, body: raced.response_body, replayed: true };
  }

  await relay(
    request.player_id,
    player!.name,
    request.event_id,
    request.type,
    false,
    rawAfter - rawBefore,
  );
  return { status: 201, body, replayed: false };
};

export const voidEvent = async (eventId: string): Promise<MatchEvent> => {
  const stored = await one<StoredEvent>(
    pool,
    `select event_id, gameweek, fixture_id, player_id, type, value, voided, body_hash, response_body
       from match_events where event_id = $1`,
    [eventId],
  );
  if (stored === undefined) throw notFound();

  const gameweek = (await gameweekByNumber(stored.gameweek))!;
  if (effectiveStatus(gameweek, new Date()) !== 'live') {
    throw conflict('gameweek_not_live', `Gameweek ${gameweek.number} is not live.`);
  }
  if (stored.voided) return { ...stored.response_body, voided: true };

  const player = (await one<{ name: string; position: Position }>(
    pool,
    'select name, position from players where id = $1',
    [stored.player_id],
  ))!;
  const before = await eventsForPlayer(stored.gameweek, stored.player_id);
  const rawBefore = rawPoints(before, player.position);

  const voided = await query<{ event_id: string }>(
    pool,
    'update match_events set voided = true where event_id = $1 and voided = false returning event_id',
    [eventId],
  );
  if (voided.length === 0) return { ...stored.response_body, voided: true };

  const after = await eventsForPlayer(stored.gameweek, stored.player_id);
  await relay(
    stored.player_id,
    player.name,
    eventId,
    stored.type,
    true,
    rawPoints(after, player.position) - rawBefore,
  );
  return { ...stored.response_body, voided: true };
};

export const eventsFor = async (gameweek: number): Promise<MatchEvent[]> => {
  const stored = await query<{ response_body: MatchEvent; voided: boolean }>(
    pool,
    'select response_body, voided from match_events where gameweek = $1 order by recorded_at, event_id',
    [gameweek],
  );
  return stored.map((entry) => ({ ...entry.response_body, voided: entry.voided }));
};

export const playedPlayers = async (gameweek: number): Promise<Set<string>> => {
  const rows = await query<{ player_id: string }>(
    pool,
    `select distinct player_id from match_events
      where gameweek = $1 and voided = false and type = 'minutes' and value >= 1`,
    [gameweek],
  );
  return new Set(rows.map((entry) => entry.player_id));
};

export const liveGameweek = async (): Promise<number | null> => {
  const gameweek = await currentGameweek();
  return effectiveStatus(gameweek, new Date()) === 'live' ? gameweek.number : null;
};
