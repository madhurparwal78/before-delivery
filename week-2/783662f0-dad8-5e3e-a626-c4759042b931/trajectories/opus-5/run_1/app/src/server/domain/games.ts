import type { PoolClient, QueryResultRow } from 'pg';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { type GameKind, SEAT_LABELS, cardName, seatCount } from '../../shared/domain.js';
import * as copy from '../../shared/copy.js';
import type { Position, ResultObject, SeatObject, TableObject } from '../../shared/types.js';
import { instant, newId, randomSeed, signed } from '../util.js';
import * as chess from './chess.js';
import * as four from './four.js';
import * as tricks from './tricks.js';
import { HOUSE, escrowAccount, walletOf, writeEntry } from './ledger.js';
import {
  type Ending,
  type Outcome,
  type Reason,
  cardWinners,
  endCopy,
  payouts,
  resultObject,
} from './settlement.js';
import { filterCards } from './visibility.js';
import { appendEvent } from './events.js';
import { unlock } from './achievements.js';
import { manifestBytes, objectSha, putObject, deleteObject, resultKeys } from '../services/storage.js';
import { StorageUnreachable } from '../services/storage.js';
import { link, queueMail } from '../services/mail.js';

export interface TableRow {
  id: string;
  server_id: string;
  world_id: string;
  name: string;
  game: GameKind;
  x: number;
  y: number;
  state: TableObject['state'];
  stake: number;
  turn_seconds: number;
  game_id: string | null;
  revision: string;
}

export interface SeatRecord {
  readonly seat: number;
  readonly character_id: string;
  readonly name: string;
}

interface ChessState {
  readonly fen: string;
  readonly repetitions: Record<string, number>;
}
interface FourState {
  readonly rows: string[];
}
interface TricksState {
  readonly hands: string[][];
  readonly trick: { seat: number; card: string }[];
  readonly led_suit: string | null;
  readonly tricks_won: number[];
  readonly leader: number;
}

export interface GameRow {
  id: string;
  server_id: string;
  table_id: string;
  game: GameKind;
  season: number;
  stake: number;
  seed: string | null;
  seats: SeatRecord[];
  hands: string[][] | null;
  moves: string[];
  position: ChessState | FourState | TricksState;
  state: 'in_play' | 'finished';
  to_move_seat: number | null;
  deadline: Date | null;
  result: ResultObject | null;
  settled: boolean;
  pending_store: boolean;
  started_at: Date;
  finished_at: Date | null;
}

export const loadGame = (id: string): Promise<GameRow | null> =>
  one<GameRow>('SELECT * FROM games WHERE id = $1', [id]);

export const seatLabel = (game: GameKind, seat: number): string =>
  SEAT_LABELS[game][seat - 1] ?? String(seat);

const isChess = (state: GameRow['position']): state is ChessState => 'fen' in state;
const isFour = (state: GameRow['position']): state is FourState => 'rows' in state;
const isTricks = (state: GameRow['position']): state is TricksState => 'hands' in state;

/** The published position for a game, whatever its kind. */
export function publishedPosition(game: GameRow): Position {
  const state = game.position;
  if (isChess(state)) return { fen: state.fen };
  if (isFour(state)) return { rows: state.rows };
  return {
    trick: state.trick,
    led_suit: state.led_suit,
    tricks_won: state.tricks_won,
  };
}

const tricksStateOf = (state: TricksState): tricks.TricksState => ({
  hands: state.hands,
  trick: state.trick,
  ledSuit: state.led_suit as tricks.TricksState['ledSuit'],
  tricksWon: state.tricks_won,
  leader: state.leader,
});

export async function seatsOfTable(tableId: string, client?: PoolClient): Promise<SeatRecord[]> {
  const sql = `SELECT s.seat, s.character_id, c.name
                 FROM seats s JOIN characters c ON c.id = s.character_id
                WHERE s.table_id = $1 ORDER BY s.seat`;
  const rows =
    client === undefined
      ? await query<SeatRecord>(sql, [tableId])
      : (await client.query<SeatRecord>(sql, [tableId])).rows;
  return rows;
}

/** Starting a game holds each seat's stake. */
export async function startGame(
  client: PoolClient,
  table: TableRow,
  season: number,
): Promise<GameRow> {
  const seats = await seatsOfTable(table.id, client);
  if (seats.length !== seatCount(table.game)) throw fail('table_not_full');

  for (const seat of seats) {
    const wallet = await walletOf(seat.character_id, client);
    if (wallet.available < table.stake) throw fail('insufficient_coins');
  }

  const id = newId();
  let position: GameRow['position'];
  let hands: string[][] | null = null;
  let seed: number | null = null;
  let toMove = 1;

  if (table.game === 'chess') {
    const board = chess.parseFen(chess.START_FEN);
    position = { fen: chess.START_FEN, repetitions: { [chess.repetitionKey(board)]: 1 } };
  } else if (table.game === 'four') {
    position = { rows: four.emptyRows() };
  } else {
    seed = randomSeed();
    hands = tricks.deal(seed);
    const lead = await firstLead(client, table.id, seats.length);
    toMove = lead;
    position = {
      hands: hands.map((hand) => [...hand]),
      trick: [],
      led_suit: null,
      tricks_won: [0, 0, 0, 0],
      leader: lead,
    };
  }

  const deadline = new Date(Date.now() + table.turn_seconds * 1000);
  await client.query(
    `INSERT INTO games (id, server_id, table_id, game, season, stake, seed, seats, hands,
                        moves, position, state, to_move_seat, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,$10,'in_play',$11,$12)`,
    [
      id,
      table.server_id,
      table.id,
      table.game,
      season,
      table.stake,
      seed,
      JSON.stringify(seats),
      hands === null ? null : JSON.stringify(hands),
      JSON.stringify(position),
      toMove,
      deadline,
    ],
  );

  if (table.stake > 0) {
    await writeEntry(client, {
      serverId: table.server_id,
      kind: 'stake',
      gameId: id,
      lines: [
        ...seats.map((seat) => ({ account: seat.character_id, amount: -table.stake })),
        { account: escrowAccount(id), amount: table.stake * seats.length },
      ],
    });
  }

  await client.query(
    `UPDATE game_tables SET state = 'in_play', game_id = $2, revision = revision + 1 WHERE id = $1`,
    [table.id, id],
  );
  await client.query('DELETE FROM rematch_offers WHERE table_id = $1', [table.id]);

  const created = await client.query<GameRow>('SELECT * FROM games WHERE id = $1', [id]);
  return created.rows[0];
}

/** In the card game, the first lead passes to the next seat on a rematch. */
async function firstLead(client: PoolClient, tableId: string, seats: number): Promise<number> {
  const previous = await client.query<{ to_move_seat: number | null; lead: number | null }>(
    `SELECT to_move_seat, (position->>'leader')::int AS lead
       FROM games WHERE table_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [tableId],
  );
  const row = previous.rows[0];
  if (row === undefined) return 1;
  const last = await client.query<{ first: number | null }>(
    `SELECT (position->>'leader')::int AS first FROM games
      WHERE table_id = $1 ORDER BY started_at ASC LIMIT 1`,
    [tableId],
  );
  const games = await client.query<{ count: string }>(
    'SELECT count(*) AS count FROM games WHERE table_id = $1',
    [tableId],
  );
  const played = Number(games.rows[0]?.count ?? 0);
  const start = last.rows[0]?.first ?? 1;
  return ((start - 1 + played) % seats) + 1;
}

export interface MoveResult {
  readonly announcement: string;
  readonly game: GameRow;
  /** Copy pushed to every viewer, when the game ended. */
  readonly endAnnouncement: string | null;
}

export class IllegalMove extends Error {
  constructor(readonly announcement: string) {
    super(announcement);
  }
}

/** Applies one accepted move under the table's row lock. */
export async function applyMove(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  seat: number,
  move: string,
): Promise<MoveResult> {
  if (game.to_move_seat !== seat) throw new IllegalMove('Illegal: it is not your turn');

  if (game.game === 'chess' && isChess(game.position)) {
    return applyChessMove(client, table, game, game.position, seat, move);
  }
  if (game.game === 'four' && isFour(game.position)) {
    return applyFourMove(client, table, game, game.position, seat, move);
  }
  if (game.game === 'tricks' && isTricks(game.position)) {
    return applyTricksMove(client, table, game, game.position, seat, move);
  }
  throw fail('game_not_in_play');
}

async function persistMove(
  client: PoolClient,
  game: GameRow,
  move: string,
  position: GameRow['position'],
  toMove: number | null,
  turnSeconds: number,
): Promise<GameRow> {
  const deadline = new Date(Date.now() + turnSeconds * 1000);
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET moves = moves || $2::jsonb, position = $3, to_move_seat = $4, deadline = $5
      WHERE id = $1 RETURNING *`,
    [game.id, JSON.stringify([move]), JSON.stringify(position), toMove, deadline],
  );
  return updated.rows[0];
}

async function applyChessMove(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  state: ChessState,
  seat: number,
  move: string,
): Promise<MoveResult> {
  const board = chess.parseFen(state.fen);
  const outcome = chess.applyMove(board, move);
  if (!outcome.ok) throw new IllegalMove(chess.refusalCopy(outcome.refusal, move));

  const next = outcome.effect.board;
  const announcement = chess.moveAnnouncement(outcome.effect, next);
  const key = chess.repetitionKey(next);
  const repetitions = { ...state.repetitions };
  repetitions[key] = (repetitions[key] ?? 0) + 1;
  const nextState: ChessState = { fen: chess.toFen(next), repetitions };
  const toMove = next.turn === 'w' ? 1 : 2;

  const checkmate = chess.isCheckmate(next);
  const stalemate = chess.isStalemate(next);
  const threefold = repetitions[key] >= 3;
  const fifty = next.halfmove >= 100 && !checkmate;

  let moved = await persistMove(client, game, move, nextState, toMove, table.turn_seconds);

  if (checkmate || stalemate || threefold || fifty) {
    const reason: Reason = checkmate
      ? 'checkmate'
      : stalemate
        ? 'stalemate'
        : threefold
          ? 'threefold_repetition'
          : 'fifty_move_rule';
    const outcomeKind: Outcome = checkmate ? 'win' : 'draw';
    const winners = checkmate ? [seat] : [];
    const ending = buildEnding(moved, table, outcomeKind, reason, winners, null);
    moved = await finishGame(client, table, moved, ending);
    if (checkmate) {
      const winner = moved.seats.find((entry) => entry.seat === seat);
      if (winner !== undefined) await unlockForSeat(client, table, winner, 'checkmate_artist');
    }
    return { announcement, game: moved, endAnnouncement: endCopy(ending) };
  }
  return { announcement, game: moved, endAnnouncement: null };
}

async function applyFourMove(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  state: FourState,
  seat: number,
  move: string,
): Promise<MoveResult> {
  const outcome = four.applyDrop(state.rows, move, seat);
  if (!outcome.ok) throw new IllegalMove('Illegal: that column is full');
  const announcement = `${seatLabel(table.game, seat)} drops in column ${move}`;
  const nextState: FourState = { rows: outcome.rows };
  const won = four.isFourInARow(outcome.rows, outcome.row, outcome.column);
  const full = four.isBoardFull(outcome.rows);
  const toMove = seat === 1 ? 2 : 1;

  let moved = await persistMove(client, game, move, nextState, toMove, table.turn_seconds);

  if (won || full) {
    const ending = buildEnding(
      moved,
      table,
      won ? 'win' : 'draw',
      won ? 'four_in_a_row' : 'board_full',
      won ? [seat] : [],
      null,
    );
    moved = await finishGame(client, table, moved, ending);
    if (won) {
      const winner = moved.seats.find((entry) => entry.seat === seat);
      if (winner !== undefined) await unlockForSeat(client, table, winner, 'four_down');
    }
    return { announcement, game: moved, endAnnouncement: endCopy(ending) };
  }
  return { announcement, game: moved, endAnnouncement: null };
}

async function applyTricksMove(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  state: TricksState,
  seat: number,
  move: string,
): Promise<MoveResult> {
  const outcome = tricks.applyPlay(tricksStateOf(state), seat, move);
  if (!outcome.ok) {
    throw new IllegalMove(
      outcome.refusal === 'must_follow_suit'
        ? 'Illegal: you must follow suit'
        : 'Illegal: that card is not in your hand',
    );
  }
  const seatName = game.seats.find((entry) => entry.seat === seat)?.name ?? '';
  let announcement = `${seatName} plays ${cardName(move)}`;
  const next = outcome.outcome.state;
  const nextState: TricksState = {
    hands: next.hands.map((hand) => [...hand]),
    trick: [...next.trick],
    led_suit: next.ledSuit,
    tricks_won: [...next.tricksWon],
    leader: next.leader,
  };
  if (outcome.outcome.trickWinner !== null) {
    const winnerName =
      game.seats.find((entry) => entry.seat === outcome.outcome.trickWinner)?.name ?? '';
    announcement = `${winnerName} wins the trick`;
  }
  const toMove = outcome.outcome.handOver ? null : tricks.seatToMove(next);
  let moved = await persistMove(client, game, move, nextState, toMove, table.turn_seconds);

  if (outcome.outcome.handOver) {
    const winners = cardWinners(nextState.tricks_won);
    const ending = buildEnding(moved, table, 'win', 'hand_over', winners, null, nextState.tricks_won);
    moved = await finishGame(client, table, moved, ending);
    for (const entry of moved.seats) {
      if ((nextState.tricks_won[entry.seat - 1] ?? 0) >= 7) {
        await unlockForSeat(client, table, entry, 'trick_taker');
      }
    }
    return { announcement, game: moved, endAnnouncement: endCopy(ending) };
  }
  return { announcement, game: moved, endAnnouncement: null };
}

async function unlockForSeat(
  client: PoolClient,
  table: TableRow,
  seat: SeatRecord,
  achievement: Parameters<typeof unlock>[4],
): Promise<void> {
  const owner = await client.query<{ user_id: string }>(
    'SELECT user_id FROM characters WHERE id = $1',
    [seat.character_id],
  );
  const userId = owner.rows[0]?.user_id;
  if (userId === undefined) return;
  await unlock(client, table.server_id, seat.character_id, userId, achievement);
}

export function buildEnding(
  game: GameRow,
  table: TableRow,
  outcome: Outcome,
  reason: Reason,
  winners: readonly number[],
  loserSeat: number | null,
  tricksWon?: readonly number[],
): Ending {
  return {
    game: table.game,
    outcome,
    reason,
    stake: game.stake,
    seats: game.seats.map((seat) => ({
      seat: seat.seat,
      characterId: seat.character_id,
      name: seat.name,
    })),
    winners,
    loserSeat,
    tricksWon,
  };
}

/** A game moves to finished; coins settle only once its result is stored. */
export async function finishGame(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  ending: Ending,
): Promise<GameRow> {
  const result = resultObject(ending);
  const finishedAt = new Date();
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET state = 'finished', result = $2, finished_at = $3,
            to_move_seat = NULL, deadline = NULL, pending_store = true
      WHERE id = $1 RETURNING *`,
    [game.id, JSON.stringify(result), finishedAt],
  );
  await client.query(
    `UPDATE game_tables SET state = 'finished', revision = revision + 1 WHERE id = $1`,
    [table.id],
  );
  return updated.rows[0];
}

/** Forfeit, timeout and abandonment all end a game the same way. */
export async function endWithoutMove(
  client: PoolClient,
  table: TableRow,
  game: GameRow,
  reason: 'forfeit' | 'timeout' | 'server_suspended',
  loserSeat: number | null,
  finishedAt?: Date,
): Promise<{ game: GameRow; ending: Ending }> {
  let ending: Ending;
  if (reason === 'server_suspended') {
    ending = buildEnding(game, table, 'abandoned', 'server_suspended', [], null);
  } else if (game.seats.length === 2) {
    const winner = game.seats.find((seat) => seat.seat !== loserSeat);
    ending = buildEnding(
      game,
      table,
      'forfeit',
      reason,
      winner === undefined ? [] : [winner.seat],
      loserSeat,
    );
  } else {
    const winners = game.seats
      .filter((seat) => seat.seat !== loserSeat)
      .map((seat) => seat.seat)
      .sort((a, b) => a - b);
    ending = buildEnding(game, table, 'forfeit', reason, winners, loserSeat);
  }
  const result = resultObject(ending);
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET state = 'finished', result = $2, finished_at = $3,
            to_move_seat = NULL, deadline = NULL, pending_store = true
      WHERE id = $1 RETURNING *`,
    [game.id, JSON.stringify(result), finishedAt ?? new Date()],
  );
  await client.query(
    `UPDATE game_tables SET state = 'finished', revision = revision + 1 WHERE id = $1`,
    [table.id],
  );
  return { game: updated.rows[0], ending };
}

export interface SettleOutcome {
  readonly settled: boolean;
}

/**
 * Writes the result bundle object and then its manifest. `pending_store` means
 * the bundle is not down yet; a failure leaves nothing behind to retry around.
 */
async function storeResultBundle(game: GameRow): Promise<boolean> {
  const keys = resultKeys(game.server_id, game.id);
  const bundle = Buffer.from(
    JSON.stringify({
      game_id: game.id,
      table_id: game.table_id,
      game: game.game,
      seats: game.seats,
      moves: game.moves,
      position: publishedPosition(game),
      result: game.result,
      seed: game.seed === null ? null : Number(game.seed),
      hands: game.hands,
      started_at: instant(game.started_at),
      finished_at: game.finished_at === null ? null : instant(game.finished_at),
    }),
    'utf8',
  );

  try {
    await putObject(keys.result, bundle);
    await putObject(
      keys.manifest,
      manifestBytes({
        kind: 'game_result',
        server_id: game.server_id,
        object: keys.result,
        sha256: objectSha(bundle),
        bytes: bundle.length,
        created_at: instant(new Date()),
      }),
    );
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      await deleteObject(keys.result);
      return false;
    }
    throw error;
  }
  await query('UPDATE games SET pending_store = false WHERE id = $1', [game.id]);
  return true;
}

/**
 * A finished game settles only after its result bundle is stored, and settles
 * exactly once across retries and instances.
 */
export async function storeAndSettle(gameId: string): Promise<SettleOutcome> {
  const game = await loadGame(gameId);
  if (game === null || game.result === null) return { settled: false };

  if (game.pending_store && !(await storeResultBundle(game))) {
    return { settled: game.settled };
  }
  if (game.settled) {
    await publishTable(game.table_id);
    return { settled: true };
  }

  const settlement = await tx(async (client) => {
    const locked = await client.query<GameRow>(
      'SELECT * FROM games WHERE id = $1 FOR UPDATE',
      [game.id],
    );
    const row = locked.rows[0];
    if (row === undefined || row.settled || row.result === null) return null;

    const table = await client.query<TableRow>(
      'SELECT * FROM game_tables WHERE id = $1 FOR UPDATE',
      [row.table_id],
    );
    const tableRow = table.rows[0];
    if (tableRow === undefined) return null;

    const paid = payouts({
      game: row.game,
      outcome: row.result.outcome,
      reason: row.result.reason,
      stake: row.stake,
      seats: row.seats.map((seat) => ({
        seat: seat.seat,
        characterId: seat.character_id,
        name: seat.name,
      })),
      winners: row.result.winners,
    });

    if (row.stake > 0) {
      await writeEntry(client, {
        serverId: row.server_id,
        kind: 'settlement',
        gameId: row.id,
        lines: [
          { account: escrowAccount(row.id), amount: -row.stake * row.seats.length },
          ...row.seats.map((seat) => ({
            account: seat.character_id,
            amount: paid.get(seat.seat) ?? 0,
          })),
        ],
      });
    }

    await client.query('UPDATE games SET settled = true WHERE id = $1', [row.id]);
    await client.query(
      `UPDATE game_tables SET state = 'settled', revision = revision + 1 WHERE id = $1`,
      [row.table_id],
    );
    return { row, tableRow };
  });

  if (settlement === null) return { settled: true };

  const { row, tableRow } = settlement;
  await publishTable(tableRow.id);
  await pushAnnouncement(row.server_id, tableRow.id, row.result?.text ?? '');
  await pushLeaderboard(row.server_id, row.game, row.season);
  await queueResultMail(row, tableRow);
  return { settled: true };
}

async function queueResultMail(game: GameRow, table: TableRow): Promise<void> {
  const server = await one<{ slug: string; name: string }>(
    'SELECT slug, name FROM servers WHERE id = $1',
    [game.server_id],
  );
  if (server === null || game.result === null) return;
  for (const seat of game.seats) {
    const owner = await one<{ handle: string; email: string }>(
      `SELECT u.handle, u.email FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
      [seat.character_id],
    );
    if (owner === null) continue;
    const line = game.result.settlement.find((entry) => entry.character_id === seat.character_id);
    const mailId = await queueMail({
      serverId: game.server_id,
      kind: 'game_result',
      toHandle: owner.handle,
      toEmail: owner.email,
      subject: `Result: ${table.name}`,
      lines: [
        game.result.text,
        `Your coins: ${signed(line?.amount ?? 0)}`,
        `Replay: ${link(`/s/${server.slug}/games/${game.id}`)}`,
      ],
      dedupeKey: `game_result:${game.id}:${seat.character_id}`,
    });
    if (mailId !== null) {
      const { attemptMail } = await import('../services/mail.js');
      await attemptMail(mailId);
    }
  }
}

export async function pushAnnouncement(
  serverId: string,
  tableId: string,
  text: string,
): Promise<void> {
  if (text === '') return;
  await appendEvent({
    serverId,
    stream: 'table',
    scopeId: tableId,
    kind: 'announcement',
    payload: { text },
  });
}

export async function publishTable(tableId: string): Promise<void> {
  const table = await one<TableRow>('SELECT * FROM game_tables WHERE id = $1', [tableId]);
  if (table === null) return;
  await appendEvent({
    serverId: table.server_id,
    stream: 'table',
    scopeId: tableId,
    kind: 'table',
    payload: { table_id: tableId },
  });
}

export async function pushLeaderboard(
  serverId: string,
  game: GameKind,
  season: number,
): Promise<void> {
  const { leaderboard } = await import('./leaderboards.js');
  const entries = await leaderboard(serverId, game, season);
  await appendEvent({
    serverId,
    stream: 'server',
    scopeId: serverId,
    kind: 'leaderboard',
    payload: { game, season, entries },
  });
}

/** `turn_remaining_ms` is measured on the server when the response is built. */
export const remainingMs = (deadline: Date | null): number | null =>
  deadline === null ? null : Math.max(0, deadline.getTime() - Date.now());

export async function tableObject(
  table: TableRow,
  viewerUserId: string,
  client?: PoolClient,
): Promise<TableObject> {
  const fetch = async <T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> =>
    client === undefined
      ? await query<T>(sql, params)
      : (await client.query<T>(sql, params as unknown[])).rows;

  const world = await fetch<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [
    table.world_id,
  ]);
  const seatRows = await fetch<{ seat: number; character_id: string; name: string; user_id: string }>(
    `SELECT s.seat, s.character_id, c.name, c.user_id
       FROM seats s JOIN characters c ON c.id = s.character_id
      WHERE s.table_id = $1 ORDER BY s.seat`,
    [table.id],
  );
  const spectatorRows = await fetch<{ character_id: string; name: string }>(
    `SELECT sp.character_id, c.name
       FROM spectators sp JOIN characters c ON c.id = sp.character_id
      WHERE sp.table_id = $1 ORDER BY c.name`,
    [table.id],
  );
  const offers = await fetch<{ character_id: string }>(
    'SELECT character_id FROM rematch_offers WHERE table_id = $1',
    [table.id],
  );

  const seats: SeatObject[] = [];
  for (let seat = 1; seat <= seatCount(table.game); seat += 1) {
    const row = seatRows.find((entry) => entry.seat === seat);
    seats.push({
      seat,
      label: seatLabel(table.game, seat),
      character: row === undefined ? null : { id: row.character_id, name: row.name },
    });
  }

  const viewerSeat = seatRows.find((row) => row.user_id === viewerUserId)?.seat ?? null;

  let game: GameRow | null = null;
  if (table.game_id !== null) {
    const rows = await fetch<GameRow>('SELECT * FROM games WHERE id = $1', [table.game_id]);
    game = rows[0] ?? null;
  }

  let hand: string[] | null = null;
  let handCounts: number[] = [];
  if (game !== null && game.game === 'tricks' && isTricks(game.position)) {
    const filtered = filterCards(
      {
        dealt: game.hands,
        remaining: game.position.hands,
        seed: game.seed === null ? null : Number(game.seed),
        handOver: game.state === 'finished',
      },
      { seat: viewerSeat },
    );
    hand = filtered.hand;
    handCounts = filtered.handCounts;
  }

  return {
    id: table.id,
    name: table.name,
    game: table.game,
    world: world[0]?.slug ?? '',
    x: table.x,
    y: table.y,
    state: table.state,
    stake: table.stake,
    turn_seconds: table.turn_seconds,
    seats,
    spectators: spectatorRows.map((row) => ({ character_id: row.character_id, name: row.name })),
    game_id: game?.id ?? null,
    turn: game?.moves.length ?? 0,
    to_move_seat: game?.to_move_seat ?? null,
    turn_remaining_ms: remainingMs(game?.deadline ?? null),
    position: game === null ? null : publishedPosition(game),
    hand,
    hand_counts: handCounts,
    result: game?.result ?? null,
    settled: game?.settled ?? false,
    pending_store: game?.pending_store ?? false,
    rematch_offers: offers.map((offer) => offer.character_id),
  };
}

/** The copy announced for one stored move, used by the replay viewer. */
export function moveCopy(game: GameRow, index: number): string {
  const move = game.moves[index];
  if (move === undefined) return '';
  if (game.game === 'chess') {
    const board = replayChessTo(game, index);
    const outcome = chess.applyMove(board, move);
    if (!outcome.ok) return move;
    return chess.moveAnnouncement(outcome.effect, outcome.effect.board);
  }
  if (game.game === 'four') {
    const seat = index % 2 === 0 ? 1 : 2;
    return `${seatLabel(game.game, seat)} drops in column ${move}`;
  }
  const replay = replayTricks(game, index + 1);
  return replay.copy;
}

function replayChessTo(game: GameRow, moves: number): chess.Board {
  let board = chess.parseFen(chess.START_FEN);
  for (let i = 0; i < moves; i += 1) {
    const outcome = chess.applyMove(board, game.moves[i]);
    if (!outcome.ok) break;
    board = outcome.effect.board;
  }
  return board;
}

interface TricksReplay {
  readonly state: tricks.TricksState;
  readonly copy: string;
}

function replayTricks(game: GameRow, moves: number): TricksReplay {
  const dealt = game.hands ?? [[], [], [], []];
  const first = isTricks(game.position) ? game.position.leader : 1;
  let state = tricks.openingState(dealt, firstLeadOf(game, first));
  let copy = '';
  for (let i = 0; i < moves && i < game.moves.length; i += 1) {
    const seat = tricks.seatToMove(state);
    const card = game.moves[i];
    const outcome = tricks.applyPlay(state, seat, card);
    if (!outcome.ok) break;
    const name = game.seats.find((entry) => entry.seat === seat)?.name ?? '';
    copy = `${name} plays ${cardName(card)}`;
    if (outcome.outcome.trickWinner !== null) {
      const winner = game.seats.find((entry) => entry.seat === outcome.outcome.trickWinner)?.name ?? '';
      copy = `${winner} wins the trick`;
    }
    state = outcome.outcome.state;
  }
  return { state, copy };
}

const firstLeadOf = (game: GameRow, fallback: number): number => {
  const firstCard = game.moves[0];
  if (firstCard === undefined) return fallback;
  const holder = (game.hands ?? []).findIndex((hand) => hand.includes(firstCard));
  return holder === -1 ? fallback : holder + 1;
};

export interface ReplayOutcome {
  readonly position: Position;
  readonly result: ResultObject | null;
}

/** Replay re-runs the stored moves and must reproduce the stored outcome. */
export function replayGame(game: GameRow): ReplayOutcome {
  if (game.game === 'chess') {
    const board = replayChessTo(game, game.moves.length);
    return { position: { fen: chess.toFen(board) }, result: game.result };
  }
  if (game.game === 'four') {
    let rows = four.emptyRows();
    game.moves.forEach((move, index) => {
      const outcome = four.applyDrop(rows, move, index % 2 === 0 ? 1 : 2);
      if (outcome.ok) rows = outcome.rows;
    });
    return { position: { rows }, result: game.result };
  }
  const replay = replayTricks(game, game.moves.length);
  return {
    position: {
      trick: replay.state.trick.map((play) => ({ seat: play.seat, card: play.card })),
      led_suit: replay.state.ledSuit,
      tricks_won: [...replay.state.tricksWon],
    },
    result: game.result,
  };
}


