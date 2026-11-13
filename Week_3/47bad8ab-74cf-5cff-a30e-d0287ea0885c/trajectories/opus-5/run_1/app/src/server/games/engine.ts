import type { PoolClient } from 'pg';
import { wordAt, wordSquares, type Direction } from '../../shared/grid';
import type {
  CellOp,
  ClaimOp,
  Colour,
  LiveRace,
  LiveSolved,
  LiveTimer,
  MarkOp,
  Op,
  OpScope,
  SquareState,
  WriteMessage,
} from '../../shared/types';
import { transaction } from '../db';
import { ApiError, errors } from '../errors';
import {
  answerAt,
  elapsedMs,
  gridTeam,
  isBlack,
  loadGameState,
  playerStats,
  revealedCount,
  scores,
  squareKey,
  whiteSquares,
  type GameState,
  type SquareRecord,
} from './state';
import { closeOpenSegment } from './timer';

export interface ApplyOutcome {
  message: WriteMessage;
  audience: 'all' | 'team';
  team: 1 | 2 | null;
  solved: LiveSolved | null;
  race: LiveRace | null;
  timer: LiveTimer | null;
  replayed: boolean;
}

const locks = new Map<string, Promise<unknown>>();

/** Writes for one game run one at a time, in arrival order. */
export async function withGameLock<T>(gameId: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(gameId) ?? Promise.resolve();
  const next = previous.then(run, run);
  locks.set(
    gameId,
    next.catch(() => undefined),
  );
  try {
    return await next;
  } finally {
    if (locks.get(gameId) === next) locks.delete(gameId);
  }
}

const VALUE_PATTERN = /^[A-Za-z0-9]{1,8}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function normalizeRequest(write: Record<string, unknown>): string {
  const keys = Object.keys(write)
    .filter((key) => key !== 'client_op_id')
    .sort();
  return JSON.stringify(keys.map((key) => [key, write[key]]));
}

function clientOpId(write: Record<string, unknown>): string | null {
  const raw = write.client_op_id;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) {
    throw errors.invalid({ client_op_id: 'Use 1 to 64 characters.' });
  }
  return raw;
}

function matchesAnswer(entry: string, answer: string): boolean {
  return entry.toUpperCase() === answer.toUpperCase();
}

function stateFor(value: string, pencil: boolean): SquareState {
  if (value === '') return 'empty';
  return pencil ? 'pencil' : 'filled';
}

function isLocked(square: SquareRecord | undefined): boolean {
  return square?.state === 'right' || square?.state === 'revealed';
}

function requireScope(raw: unknown): OpScope {
  if (raw !== 'square' && raw !== 'word' && raw !== 'puzzle') {
    throw errors.invalid({ scope: 'Use square, word or puzzle.' });
  }
  return raw;
}

function requireDirection(raw: unknown): Direction {
  if (raw !== 'across' && raw !== 'down') {
    throw errors.invalid({ direction: 'Use across or down.' });
  }
  return raw;
}

function requireWhiteSquare(state: GameState, row: unknown, col: unknown): { row: number; col: number } {
  if (!isInteger(row) || !isInteger(col) || isBlack(state.puzzle, row, col)) {
    throw errors.invalid({ row: 'That square is not part of the grid.' });
  }
  return { row, col };
}

function scopeSquares(
  state: GameState,
  scope: OpScope,
  write: Record<string, unknown>,
): { row: number; col: number }[] {
  if (scope === 'puzzle') return whiteSquares(state.puzzle);
  const { row, col } = requireWhiteSquare(state, write.row, write.col);
  if (scope === 'square') return [{ row, col }];
  const direction = requireDirection(write.direction);
  const word = wordAt(state.layout, row, col, direction);
  if (!word) throw errors.invalid({ direction: 'That square has no word in that direction.' });
  return wordSquares(word);
}

function squareOf(state: GameState, team: number, row: number, col: number): SquareRecord {
  const square = state.squares.get(squareKey(team, row, col));
  if (!square) {
    throw new Error(`missing square row ${row} col ${col} for team ${team}`);
  }
  return square;
}

async function writeSquare(
  client: PoolClient,
  state: GameState,
  team: number,
  row: number,
  col: number,
  next: { value: string; pencil: boolean; state: SquareState; owner: Colour | null },
): Promise<void> {
  await client.query(
    `update squares set value = $1, pencil = $2, state = $3, owner = $4
      where game_id = $5 and team = $6 and row = $7 and col = $8`,
    [next.value, next.pencil, next.state, next.owner, state.game.id, team, row, col],
  );
  const square = squareOf(state, team, row, col);
  square.value = next.value;
  square.pencil = next.pencil;
  square.state = next.state;
  square.owner = next.owner;
}

function solvedNow(state: GameState): boolean {
  if (state.game.mode === 'race') return false;
  for (const { row, col } of whiteSquares(state.puzzle)) {
    const square = squareOf(state, 0, row, col);
    if (square.value === '') return false;
    if (!matchesAnswer(square.value, answerAt(state.puzzle, row, col))) return false;
  }
  return true;
}

function raceComplete(state: GameState): boolean {
  return state.claims.length === whiteSquares(state.puzzle).length;
}

async function finishGame(
  client: PoolClient,
  state: GameState,
  seq: number,
  at: Date,
): Promise<void> {
  await closeOpenSegment(client, state, at);
  await client.query(
    `update games set status = 'solved', solved_at = $2, solved_seq = $3 where id = $1`,
    [state.game.id, at, seq],
  );
  state.game.status = 'solved';
  state.game.solved_at = at;
  state.game.solved_seq = seq;
}

async function recordHistory(client: PoolClient, state: GameState): Promise<void> {
  for (const seat of state.seats) {
    await client.query(
      `insert into history_entries (game_id, player_id) values ($1, $2)
         on conflict do nothing`,
      [state.game.id, seat.player_id],
    );
  }
}

interface Context {
  client: PoolClient;
  state: GameState;
  playerId: string;
  colour: Colour;
  team: 1 | 2 | null;
  grid: number;
  seq: number;
  at: Date;
  opId: string | null;
}

async function storeOp(
  context: Context,
  op: Op,
  message: WriteMessage,
  request: Record<string, unknown>,
): Promise<void> {
  const { client, state } = context;
  await client.query(
    `insert into ops (game_id, seq, type, by, at, client_op_id, team, op, message, request)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      state.game.id,
      context.seq,
      op.type,
      context.playerId,
      context.at,
      context.opId,
      context.team,
      JSON.stringify(op),
      JSON.stringify(message),
      JSON.stringify({ shape: normalizeRequest(request) }),
    ],
  );
  await client.query('update games set seq = $2 where id = $1', [state.game.id, context.seq]);
  state.game.seq = context.seq;
}

function baseOp(context: Context): {
  seq: number;
  by: string;
  at: string;
  client_op_id: string | null;
  team?: 1 | 2;
} {
  const base = {
    seq: context.seq,
    by: context.playerId,
    at: context.at.toISOString(),
    client_op_id: context.opId,
  };
  return context.state.game.mode === 'race' && context.team !== null
    ? { ...base, team: context.team }
    : base;
}

async function solveIfComplete(context: Context): Promise<{
  solved: LiveSolved | null;
  timer: LiveTimer | null;
}> {
  const { state } = context;
  if (!solvedNow(state)) return { solved: null, timer: null };
  await finishGame(context.client, state, context.seq, context.at);
  await recordHistory(context.client, state);
  const elapsed = elapsedMs(state, context.at.getTime());
  return {
    solved: {
      type: 'solved',
      seq: context.seq,
      elapsed_ms: elapsed,
      revealed_count: revealedCount(state),
      stats: playerStats(state),
    },
    timer: { type: 'timer', state: 'solved', elapsed_ms: elapsed },
  };
}

async function applyCell(
  context: Context,
  write: Record<string, unknown>,
  autocheckOn: boolean,
): Promise<ApplyOutcome> {
  const { state } = context;
  const { row, col } = requireWhiteSquare(state, write.row, write.col);
  const rawValue = write.value;
  if (typeof rawValue !== 'string' || (rawValue !== '' && !VALUE_PATTERN.test(rawValue))) {
    throw errors.invalid({ value: 'Use 1 to 8 letters or digits.' });
  }
  if (typeof write.pencil !== 'boolean') {
    throw errors.invalid({ pencil: 'Use true or false.' });
  }
  const value = rawValue.toUpperCase();
  const pencil = write.pencil;
  const cleared = value === '';
  let squareState = stateFor(value, pencil);
  let autocheck = false;
  if (!cleared && !pencil && autocheckOn && state.game.mode === 'shared') {
    autocheck = true;
    squareState = matchesAnswer(value, answerAt(state.puzzle, row, col)) ? 'right' : 'wrong';
  }
  const owner = cleared ? null : context.colour;
  await writeSquare(context.client, state, context.grid, row, col, {
    value,
    pencil: cleared ? false : pencil,
    state: squareState,
    owner,
  });

  const op: CellOp = {
    ...baseOp(context),
    type: 'cell',
    row,
    col,
    value,
    pencil: cleared ? false : pencil,
    state: squareState,
    owner,
    autocheck,
  };
  const message: WriteMessage = {
    type: 'cell',
    seq: context.seq,
    row,
    col,
    value,
    pencil: op.pencil,
    state: squareState,
    owner,
    by: context.playerId,
    client_op_id: context.opId,
    autocheck,
  };
  await storeOp(context, op, message, write);
  const finish = await solveIfComplete(context);
  return {
    message,
    audience: state.game.mode === 'race' ? 'team' : 'all',
    team: context.team,
    solved: finish.solved,
    race: null,
    timer: finish.timer,
    replayed: false,
  };
}

async function applyRaceCheck(
  context: Context,
  write: Record<string, unknown>,
): Promise<ApplyOutcome> {
  const { state } = context;
  if (write.scope !== 'square') {
    throw errors.invalid({ scope: 'A race allows only a square check.' });
  }
  const { row, col } = requireWhiteSquare(state, write.row, write.col);
  const team = context.team as 1 | 2;
  const square = squareOf(state, team, row, col);
  if (square.value === '') {
    throw errors.invalid({ row: 'That square is empty.' });
  }
  const answer = answerAt(state.puzzle, row, col);
  if (!matchesAnswer(square.value, answer)) {
    await writeSquare(context.client, state, team, row, col, {
      value: square.value,
      pencil: square.pencil,
      state: 'wrong',
      owner: square.owner,
    });
    const op: MarkOp = {
      ...baseOp(context),
      type: 'check',
      scope: 'square',
      row,
      col,
      direction: null,
      squares: [{ row, col, state: 'wrong' }],
    };
    const message: WriteMessage = {
      type: 'check',
      seq: context.seq,
      scope: 'square',
      by: context.playerId,
      wrong: 1,
      squares: [{ row, col, state: 'wrong' }],
      client_op_id: context.opId,
    };
    await context.client.query(
      'update games set checked_count = checked_count + 1 where id = $1',
      [state.game.id],
    );
    state.game.checked_count += 1;
    await storeOp(context, op, message, write);
    return {
      message,
      audience: 'team',
      team,
      solved: null,
      race: null,
      timer: null,
      replayed: false,
    };
  }

  for (const grid of [1, 2]) {
    await writeSquare(context.client, state, grid, row, col, {
      value: answer,
      pencil: false,
      state: 'right',
      owner: context.colour,
    });
  }
  await context.client.query(
    `insert into race_claims (game_id, row, col, team, player_id, owner)
       values ($1, $2, $3, $4, $5, $6)`,
    [state.game.id, row, col, team, context.playerId, context.colour],
  );
  state.claims.push({ row, col, team, player_id: context.playerId, owner: context.colour });
  await context.client.query(
    'update game_players set score = score + 1 where game_id = $1 and player_id = $2',
    [state.game.id, context.playerId],
  );
  const seat = state.seats.find((s) => s.player_id === context.playerId);
  if (seat) seat.score += 1;

  const op: ClaimOp = {
    ...baseOp(context),
    type: 'claim',
    row,
    col,
    team,
    owner: context.colour,
    squares: [{ row, col, state: 'right', value: answer }],
  };
  const message: WriteMessage = {
    type: 'claim',
    seq: context.seq,
    row,
    col,
    value: answer,
    owner: context.colour,
    team,
    by: context.playerId,
    scores: scores(state),
    client_op_id: context.opId,
  };
  await storeOp(context, op, message, write);

  let race: LiveRace | null = null;
  let timer: LiveTimer | null = null;
  if (raceComplete(state)) {
    await context.client.query(`update games set race_state = 'finished' where id = $1`, [
      state.game.id,
    ]);
    state.game.race_state = 'finished';
    await finishGame(context.client, state, context.seq, context.at);
    race = { type: 'race', state: 'finished', scores: scores(state) };
    timer = { type: 'timer', state: 'solved', elapsed_ms: elapsedMs(state, context.at.getTime()) };
  }
  return { message, audience: 'all', team, solved: null, race, timer, replayed: false };
}

async function applyCheck(
  context: Context,
  write: Record<string, unknown>,
): Promise<ApplyOutcome> {
  const { state } = context;
  if (state.game.mode === 'race') return applyRaceCheck(context, write);
  const scope = requireScope(write.scope);
  const squares = scopeSquares(state, scope, write);
  const changed: { row: number; col: number; state: SquareState }[] = [];
  let wrong = 0;
  for (const { row, col } of squares) {
    const square = squareOf(state, 0, row, col);
    if (square.value === '' || isLocked(square)) continue;
    const right = matchesAnswer(square.value, answerAt(state.puzzle, row, col));
    const next: SquareState = right ? 'right' : 'wrong';
    await writeSquare(context.client, state, 0, row, col, {
      value: square.value,
      pencil: right ? false : square.pencil,
      state: next,
      owner: square.owner,
    });
    if (!right) wrong += 1;
    changed.push({ row, col, state: next });
  }
  await context.client.query('update games set checked_count = checked_count + 1 where id = $1', [
    state.game.id,
  ]);
  state.game.checked_count += 1;
  const op: MarkOp = {
    ...baseOp(context),
    type: 'check',
    scope,
    row: scope === 'puzzle' ? null : (write.row as number),
    col: scope === 'puzzle' ? null : (write.col as number),
    direction: scope === 'word' ? (write.direction as Direction) : null,
    squares: changed,
  };
  const message: WriteMessage = {
    type: 'check',
    seq: context.seq,
    scope,
    by: context.playerId,
    wrong,
    squares: changed,
    client_op_id: context.opId,
  };
  await storeOp(context, op, message, write);
  return {
    message,
    audience: 'all',
    team: null,
    solved: null,
    race: null,
    timer: null,
    replayed: false,
  };
}

async function applyReveal(
  context: Context,
  write: Record<string, unknown>,
): Promise<ApplyOutcome> {
  const { state } = context;
  if (state.game.mode === 'race') {
    throw errors.invalid({ type: 'A race has no reveals.' });
  }
  const scope = requireScope(write.scope);
  const squares = scopeSquares(state, scope, write);
  const changed: { row: number; col: number; value: string; state: 'revealed'; owner: Colour }[] =
    [];
  for (const { row, col } of squares) {
    const square = squareOf(state, 0, row, col);
    if (isLocked(square)) continue;
    const answer = answerAt(state.puzzle, row, col);
    await writeSquare(context.client, state, 0, row, col, {
      value: answer,
      pencil: false,
      state: 'revealed',
      owner: context.colour,
    });
    changed.push({ row, col, value: answer, state: 'revealed', owner: context.colour });
  }
  const op: MarkOp = {
    ...baseOp(context),
    type: 'reveal',
    scope,
    row: scope === 'puzzle' ? null : (write.row as number),
    col: scope === 'puzzle' ? null : (write.col as number),
    direction: scope === 'word' ? (write.direction as Direction) : null,
    squares: changed.map((square) => ({ row: square.row, col: square.col, state: square.state, value: square.value })),
  };
  const message: WriteMessage = {
    type: 'reveal',
    seq: context.seq,
    scope,
    by: context.playerId,
    revealed: changed.length,
    squares: changed,
    client_op_id: context.opId,
  };
  await storeOp(context, op, message, write);
  const finish = await solveIfComplete(context);
  return {
    message,
    audience: 'all',
    team: null,
    solved: finish.solved,
    race: null,
    timer: finish.timer,
    replayed: false,
  };
}

/** A candidate is protected when its crossing word is full; a word is full when every square holds an entry. */
function crossingFull(state: GameState, row: number, col: number, direction: Direction): boolean | null {
  const crossing = wordAt(state.layout, row, col, direction === 'across' ? 'down' : 'across');
  if (!crossing) return null;
  return wordSquares(crossing).every(
    (square) => squareOf(state, 0, square.row, square.col).value !== '',
  );
}

async function applyClear(
  context: Context,
  write: Record<string, unknown>,
): Promise<ApplyOutcome> {
  const { state } = context;
  const race = state.game.mode === 'race';
  if (write.scope !== 'word' && write.scope !== 'puzzle') {
    throw errors.invalid({ scope: 'Use word or puzzle.' });
  }
  const scope: 'word' | 'puzzle' = write.scope;
  if (race && scope === 'puzzle') {
    throw errors.invalid({ scope: 'A race allows only a word clear.' });
  }
  const grid = context.grid;
  let targets: { row: number; col: number }[];
  if (scope === 'puzzle') {
    targets = whiteSquares(state.puzzle).filter((square) => {
      const record = squareOf(state, grid, square.row, square.col);
      return record.value !== '' && !isLocked(record);
    });
  } else {
    const { row, col } = requireWhiteSquare(state, write.row, write.col);
    const direction = requireDirection(write.direction);
    const word = wordAt(state.layout, row, col, direction);
    if (!word) throw errors.invalid({ direction: 'That square has no word in that direction.' });
    const candidates = wordSquares(word).filter((square) => {
      const record = squareOf(state, grid, square.row, square.col);
      return record.value !== '' && !isLocked(record);
    });
    const unprotected = candidates.filter(
      (square) => crossingFull(state, square.row, square.col, direction) !== true,
    );
    targets = unprotected.length > 0 ? unprotected : candidates;
  }
  for (const target of targets) {
    await writeSquare(context.client, state, grid, target.row, target.col, {
      value: '',
      pencil: false,
      state: 'empty',
      owner: null,
    });
  }
  const op: MarkOp = {
    ...baseOp(context),
    type: 'clear',
    scope,
    row: scope === 'puzzle' ? null : (write.row as number),
    col: scope === 'puzzle' ? null : (write.col as number),
    direction: scope === 'word' ? (write.direction as Direction) : null,
    squares: targets.map((target) => ({ row: target.row, col: target.col, state: 'empty' as const })),
  };
  const message: WriteMessage = {
    type: 'clear',
    seq: context.seq,
    scope,
    by: context.playerId,
    cleared: targets.length,
    squares: targets.map((target) => ({ row: target.row, col: target.col })),
    client_op_id: context.opId,
  };
  await storeOp(context, op, message, write);
  return {
    message,
    audience: race ? 'team' : 'all',
    team: context.team,
    solved: null,
    race: null,
    timer: null,
    replayed: false,
  };
}

interface StoredOp {
  message: WriteMessage;
  request: { shape: string };
  team: 1 | 2 | null;
  type: string;
}

export async function applyWrite(
  gameId: string,
  playerId: string,
  raw: unknown,
): Promise<ApplyOutcome> {
  const write = asRecord(raw);
  const type = write.type;
  if (type !== 'cell' && type !== 'check' && type !== 'reveal' && type !== 'clear') {
    throw errors.invalid({ type: 'Use cell, check, reveal or clear.' });
  }
  return transaction(async (client) => {
    const state = await loadGameState(gameId, client);
    if (!state) throw errors.notFound();
    const seat = state.seats.find((candidate) => candidate.player_id === playerId);
    if (!seat) throw errors.notFound();
    const race = state.game.mode === 'race';

    if (race && seat.team === null) throw new ApiError('watching');

    const opId = clientOpId(write);
    if (opId !== null) {
      const stored = await client.query(
        'select message, request, team, type from ops where game_id = $1 and by = $2 and client_op_id = $3',
        [gameId, playerId, opId],
      );
      const previous = stored.rows[0] as StoredOp | undefined;
      if (previous) {
        if (previous.request.shape !== normalizeRequest(write)) {
          throw new ApiError('op_id_reused');
        }
        return {
          message: previous.message,
          audience: race && previous.type !== 'claim' ? ('team' as const) : ('all' as const),
          team: previous.team,
          solved: null,
          race: null,
          timer: null,
          replayed: true,
        };
      }
    }

    if (state.game.status === 'solved') throw new ApiError('game_solved');
    if (race && state.game.race_state === 'lobby') throw new ApiError('race_not_started');

    const grid = gridTeam(state, playerId);
    if (
      (type === 'cell' || (race && type === 'check' && write.scope === 'square')) &&
      isInteger(write.row) &&
      isInteger(write.col) &&
      !isBlack(state.puzzle, write.row, write.col)
    ) {
      if (isLocked(state.squares.get(squareKey(grid, write.row, write.col)))) {
        throw new ApiError('square_locked');
      }
    }

    const settings = await client.query<{ autocheck: boolean }>(
      'select autocheck from players where id = $1',
      [playerId],
    );
    const context: Context = {
      client,
      state,
      playerId,
      colour: seat.colour,
      team: seat.team,
      grid,
      seq: state.game.seq + 1,
      at: new Date(),
      opId,
    };
    switch (type) {
      case 'cell':
        return applyCell(context, write, settings.rows[0]?.autocheck === true);
      case 'check':
        return applyCheck(context, write);
      case 'reveal':
        return applyReveal(context, write);
      case 'clear':
        return applyClear(context, write);
    }
  });
}
