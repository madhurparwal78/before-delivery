import type { Colour, SquareJson, SquareState } from '../../shared/types';
import { query } from '../db';
import { validDisplayName } from '../domain/names';
import { errors } from '../errors';
import { createGame } from '../games/service';
import { loadGameState, whiteSquares, type GameState, type PuzzleRecord } from '../games/state';
import { startSegment } from '../games/timer';
import { readJson, sendJson, setPlayerCookie } from '../http';
import { schedulePauseIfEmpty } from '../live';
import { createUpload } from '../puzzles';
import type { RouteContext } from './context';
import { createPlayer } from './players';

interface SeedPlayer {
  key: string;
  display_name: unknown;
  settings?: { skip_filled: boolean; jump_next_clue: boolean; autocheck: boolean };
}

interface SeedPuzzle {
  key: string;
  fixture?: string;
  text?: string;
  owner?: string;
}

interface SeedSquare {
  row: number;
  col: number;
  value: string;
  pencil?: boolean;
  state: SquareState;
  owner: string;
  team?: 1 | 2;
}

interface SeedGame {
  key: string;
  puzzle: string;
  host: string;
  players?: string[];
  squares?: SeedSquare[];
  elapsed_ms?: number;
  timer_state?: 'paused' | 'running';
  mode?: 'shared' | 'race';
  race_state?: 'lobby' | 'racing';
  teams?: Record<string, 1 | 2>;
}

function list<T>(raw: unknown, field: string): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw errors.invalid({ [field]: 'Send a list.' });
  return raw as T[];
}

function need<T>(map: Map<string, T>, key: unknown, field: string): T {
  if (typeof key !== 'string' || !map.has(key)) {
    throw errors.invalid({ [field]: `Unknown key ${String(key)}.` });
  }
  return map.get(key) as T;
}

async function seedSquares(state: GameState, squares: SeedSquare[], colours: Map<string, Colour>): Promise<void> {
  const race = state.game.mode === 'race';
  for (const square of squares) {
    const owner = need(colours, square.owner, 'squares');
    const claimed = race && square.team === undefined;
    const state_ = square.state;
    if (claimed && state_ !== 'right') {
      throw errors.invalid({ squares: 'A claimed square must be right.' });
    }
    const teams = race ? (claimed ? [1, 2] : [square.team as number]) : [0];
    for (const team of teams) {
      await query(
        `update squares set value = $5, pencil = $6, state = $7, owner = $8
          where game_id = $1 and team = $2 and row = $3 and col = $4`,
        [
          state.game.id,
          team,
          square.row,
          square.col,
          square.value.toUpperCase(),
          square.pencil === true,
          state_,
          owner,
        ],
      );
    }
    if (claimed) {
      const player = [...colours.entries()].find(([, colour]) => colour === owner);
      const seat = state.seats.find((candidate) => candidate.colour === owner);
      if (!player || !seat) throw errors.invalid({ squares: 'Unknown square owner.' });
      await query(
        `insert into race_claims (game_id, row, col, team, player_id, owner)
           values ($1, $2, $3, $4, $5, $6)`,
        [state.game.id, square.row, square.col, seat.team ?? 1, seat.player_id, owner],
      );
      await query(
        'update game_players set score = score + 1 where game_id = $1 and player_id = $2',
        [state.game.id, seat.player_id],
      );
    }
  }
}

export async function postSeed({ req, res }: RouteContext): Promise<void> {
  const body = await readJson(req);
  const players = new Map<string, { id: string; display_name: string }>();
  const playerColours = new Map<string, Colour>();
  const puzzles = new Map<string, PuzzleRecord>();
  const games = new Map<string, { id: string; code: string; url: string }>();

  for (const player of list<SeedPlayer>(body.players, 'players')) {
    const created = await createPlayer(validDisplayName(player.display_name));
    players.set(player.key, created);
    if (player.settings) {
      await query(
        'update players set skip_filled = $2, jump_next_clue = $3, autocheck = $4 where id = $1',
        [
          created.id,
          player.settings.skip_filled,
          player.settings.jump_next_clue,
          player.settings.autocheck,
        ],
      );
    }
  }

  for (const puzzle of list<SeedPuzzle>(body.puzzles, 'puzzles')) {
    if (typeof puzzle.fixture === 'string') {
      const found = await query<PuzzleRecord>('select * from puzzles where fixture = $1', [
        puzzle.fixture,
      ]);
      if (!found.rows[0]) throw errors.invalid({ puzzles: `Unknown fixture ${puzzle.fixture}.` });
      puzzles.set(puzzle.key, found.rows[0]);
    } else if (typeof puzzle.text === 'string') {
      const owner = need(players, puzzle.owner, 'puzzles');
      const created = await createUpload(new TextEncoder().encode(puzzle.text), owner.id);
      puzzles.set(puzzle.key, created.puzzle);
    } else {
      throw errors.invalid({ puzzles: 'Give a fixture or text.' });
    }
  }

  for (const game of list<SeedGame>(body.games, 'games')) {
    const puzzle = need(puzzles, game.puzzle, 'games');
    const host = need(players, game.host, 'games');
    const keys = game.players && game.players.length > 0 ? game.players : [game.host];
    if (!keys.includes(game.host)) throw errors.invalid({ games: 'The host must be a player.' });
    const seatOrder = keys.map((key) => need(players, key, 'games').id);
    const mode = game.mode === 'race' ? 'race' : 'shared';
    const state = await createGame(puzzle, host.id, mode, seatOrder);

    const colours = new Map<string, Colour>();
    for (const [index, key] of keys.entries()) {
      colours.set(key, state.seats[index].colour);
      playerColours.set(key, state.seats[index].colour);
    }

    if (mode === 'race') {
      for (const [key, team] of Object.entries(game.teams ?? {})) {
        const player = need(players, key, 'games');
        await query('update game_players set team = $3 where game_id = $1 and player_id = $2', [
          state.game.id,
          player.id,
          team,
        ]);
      }
      const raceState = game.race_state === 'racing' ? 'racing' : 'lobby';
      await query('update games set race_state = $2 where id = $1', [state.game.id, raceState]);
    }

    const fresh = (await loadGameState(state.game.id)) as GameState;
    await seedSquares(fresh, game.squares ?? [], colours);

    const elapsed = typeof game.elapsed_ms === 'number' ? Math.max(0, game.elapsed_ms) : 0;
    const running = game.timer_state === 'running';
    const now = Date.now();
    if (running) {
      await query(`update games set status = 'live' where id = $1`, [state.game.id]);
      await startSegment(null, state.game.id, new Date(now - elapsed));
      schedulePauseIfEmpty(state.game.id, new Date(now));
    } else if (elapsed > 0) {
      await query(`update games set status = 'paused' where id = $1`, [state.game.id]);
      await query(
        'insert into timer_segments (game_id, idx, started_at, ended_at) values ($1, 0, $2, $3)',
        [state.game.id, new Date(now - elapsed), new Date(now)],
      );
    }

    const seeded = (await loadGameState(state.game.id)) as GameState;
    const initial: SquareJson[] = whiteSquares(seeded.puzzle).map(({ row, col }) => {
      const square = seeded.squares.get(`${mode === 'race' ? 1 : 0}:${row}:${col}`);
      return square
        ? { row, col, value: square.value, pencil: square.pencil, state: square.state, owner: square.owner }
        : { row, col, value: '', pencil: false, state: 'empty', owner: null };
    });
    await query('update games set initial_squares = $2 where id = $1', [
      state.game.id,
      JSON.stringify(initial),
    ]);

    games.set(game.key, {
      id: state.game.id,
      code: state.game.code as string,
      url: `/g/${state.game.code}`,
    });
  }

  sendJson(res, 201, {
    players: Object.fromEntries(players),
    puzzles: Object.fromEntries(
      [...puzzles.entries()].map(([key, puzzle]) => [key, { id: puzzle.id }]),
    ),
    games: Object.fromEntries(games),
  });
}

export async function postSession({ req, res }: RouteContext): Promise<void> {
  const body = await readJson(req);
  if (typeof body.player_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.player_id)) {
    throw errors.notFound();
  }
  const found = await query('select id from players where id = $1', [body.player_id]);
  if (found.rowCount === 0) throw errors.notFound();
  setPlayerCookie(res, body.player_id);
  res.writeHead(204);
  res.end();
}
