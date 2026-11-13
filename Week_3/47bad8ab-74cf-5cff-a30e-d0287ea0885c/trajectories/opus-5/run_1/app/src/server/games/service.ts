import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { COLOURS, type Colour, type SquareJson } from '../../shared/types';
import { config } from '../config';
import { query, transaction } from '../db';
import { ApiError, errors } from '../errors';
import {
  loadGameState,
  squareJson,
  squareKey,
  whiteSquares,
  type GameState,
  type PuzzleRecord,
} from './state';

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newGameCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function nextColour(used: Colour[]): Colour {
  const free = COLOURS.find((colour) => !used.includes(colour));
  if (!free) throw new ApiError('game_full');
  return free;
}

async function insertSquares(
  client: PoolClient,
  gameId: string,
  puzzle: PuzzleRecord,
  teams: number[],
): Promise<void> {
  for (const team of teams) {
    for (const { row, col } of whiteSquares(puzzle)) {
      await client.query(
        'insert into squares (game_id, team, row, col) values ($1, $2, $3, $4)',
        [gameId, team, row, col],
      );
    }
  }
}

export async function createGame(
  puzzle: PuzzleRecord,
  hostPlayerId: string,
  mode: 'shared' | 'race',
  seatOrder: string[] = [hostPlayerId],
): Promise<GameState> {
  const gameId = randomUUID();
  const code = newGameCode();
  const initial: SquareJson[] = whiteSquares(puzzle).map(({ row, col }) => ({
    row,
    col,
    value: '',
    pencil: false,
    state: 'empty',
    owner: null,
  }));
  await transaction(async (client) => {
    await client.query(
      `insert into games (id, puzzle_id, host_player_id, code, link_state, status, mode, race_state, initial_squares)
         values ($1, $2, $3, $4, 'active', 'open', $5, $6, $7)`,
      [
        gameId,
        puzzle.id,
        hostPlayerId,
        code,
        mode,
        mode === 'race' ? 'lobby' : null,
        JSON.stringify(initial),
      ],
    );
    await client.query(
      `insert into game_codes (code, game_id, state) values ($1, $2, 'active')`,
      [code, gameId],
    );
    for (const [index, playerId] of seatOrder.entries()) {
      await client.query(
        `insert into game_players (game_id, player_id, colour, host, seat, joined_code)
           values ($1, $2, $3, $4, $5, $6)`,
        [gameId, playerId, COLOURS[index], playerId === hostPlayerId, index, code],
      );
    }
    await insertSquares(client, gameId, puzzle, mode === 'race' ? [1, 2] : [0]);
  });
  const state = await loadGameState(gameId);
  if (!state) throw errors.notFound();
  return state;
}

/** The one link access check: the host always, anyone else through the current active code. */
export async function gameAccess(gameId: string, playerId: string): Promise<GameState> {
  const state = await loadGameState(gameId);
  if (!state) throw errors.notFound();
  if (state.game.host_player_id === playerId) return state;
  const seat = state.seats.find((candidate) => candidate.player_id === playerId);
  if (!seat) throw errors.notFound();
  const joinedCode = await query<{ joined_code: string | null }>(
    'select joined_code from game_players where game_id = $1 and player_id = $2',
    [gameId, playerId],
  );
  const code = joinedCode.rows[0]?.joined_code;
  if (state.game.link_state !== 'active' || code !== state.game.code) throw errors.notFound();
  return state;
}

export async function joinByCode(code: string, playerId: string): Promise<GameState> {
  const codes = await query<{ game_id: string; state: 'active' | 'off' | 'replaced' }>(
    'select game_id, state from game_codes where code = $1',
    [code],
  );
  const row = codes.rows[0];
  if (!row) throw errors.notFound();
  if (row.state === 'off') throw new ApiError('link_off');
  if (row.state === 'replaced') throw new ApiError('link_replaced');
  const state = await loadGameState(row.game_id);
  if (!state) throw errors.notFound();
  const seat = state.seats.find((candidate) => candidate.player_id === playerId);
  if (seat) {
    await query('update game_players set joined_code = $3 where game_id = $1 and player_id = $2', [
      state.game.id,
      playerId,
      code,
    ]);
    return (await loadGameState(state.game.id)) as GameState;
  }
  if (state.game.status === 'solved') throw new ApiError('game_solved');
  if (state.seats.length >= config.maxPlayers) throw new ApiError('game_full');
  const colour = nextColour(state.seats.map((candidate) => candidate.colour));
  await query(
    `insert into game_players (game_id, player_id, colour, host, seat, joined_code)
       values ($1, $2, $3, false, $4, $5)`,
    [state.game.id, playerId, colour, state.seats.length, code],
  );
  return (await loadGameState(state.game.id)) as GameState;
}

export async function linkInfo(code: string): Promise<{
  game_id: string;
  puzzle_title: string;
  status: string;
  player_count: number;
}> {
  const codes = await query<{ game_id: string; state: 'active' | 'off' | 'replaced' }>(
    'select game_id, state from game_codes where code = $1',
    [code],
  );
  const row = codes.rows[0];
  if (!row) throw errors.notFound();
  if (row.state === 'off') throw new ApiError('link_off');
  if (row.state === 'replaced') throw new ApiError('link_replaced');
  const state = await loadGameState(row.game_id);
  if (!state) throw errors.notFound();
  return {
    game_id: state.game.id,
    puzzle_title: state.puzzle.title,
    status: state.game.status,
    player_count: state.seats.length,
  };
}

export async function turnLinkOff(state: GameState, playerId: string): Promise<GameState> {
  if (state.game.host_player_id !== playerId) throw new ApiError('not_host');
  if (state.game.link_state === 'off') throw new ApiError('link_already_off');
  await transaction(async (client) => {
    await client.query(`update game_codes set state = 'off' where game_id = $1 and state = 'active'`, [
      state.game.id,
    ]);
    await client.query(`update games set link_state = 'off' where id = $1`, [state.game.id]);
  });
  return (await loadGameState(state.game.id)) as GameState;
}

export async function replaceLink(state: GameState, playerId: string): Promise<GameState> {
  if (state.game.host_player_id !== playerId) throw new ApiError('not_host');
  const code = newGameCode();
  await transaction(async (client) => {
    await client.query(
      `update game_codes set state = 'replaced' where game_id = $1 and state = 'active'`,
      [state.game.id],
    );
    await client.query(`insert into game_codes (code, game_id, state) values ($1, $2, 'active')`, [
      code,
      state.game.id,
    ]);
    await client.query(`update games set link_state = 'active', code = $2 where id = $1`, [
      state.game.id,
      code,
    ]);
    await client.query(
      `update game_players set joined_code = $2 where game_id = $1 and host = true`,
      [state.game.id, code],
    );
  });
  return (await loadGameState(state.game.id)) as GameState;
}

export async function setTeam(
  state: GameState,
  playerId: string,
  team: unknown,
): Promise<GameState> {
  if (state.game.mode !== 'race') throw errors.invalid({ team: 'This game is not a race.' });
  if (state.game.race_state !== 'lobby') throw new ApiError('race_started');
  if (team !== 1 && team !== 2 && team !== null) {
    throw errors.invalid({ team: 'Use 1, 2 or null.' });
  }
  await query('update game_players set team = $3 where game_id = $1 and player_id = $2', [
    state.game.id,
    playerId,
    team,
  ]);
  return (await loadGameState(state.game.id)) as GameState;
}

export async function startRace(state: GameState, playerId: string): Promise<GameState> {
  if (state.game.host_player_id !== playerId) throw new ApiError('not_host');
  if (state.game.mode !== 'race') throw errors.invalid({ mode: 'This game is not a race.' });
  if (state.game.race_state !== 'lobby') throw new ApiError('race_started');
  const teams = new Set(state.seats.map((seat) => seat.team).filter((team) => team !== null));
  if (!teams.has(1) || !teams.has(2)) {
    throw errors.invalid({ teams: 'Each team needs at least one player.' });
  }
  await query(`update games set race_state = 'racing' where id = $1`, [state.game.id]);
  return (await loadGameState(state.game.id)) as GameState;
}

export function initialSquares(state: GameState): SquareJson[] {
  return state.game.initial_squares;
}

export function finalSquares(state: GameState): SquareJson[] {
  return whiteSquares(state.puzzle).map(({ row, col }) => {
    const square = state.squares.get(squareKey(0, row, col));
    return square
      ? squareJson(square)
      : { row, col, value: '', pencil: false, state: 'empty' as const, owner: null };
  });
}
