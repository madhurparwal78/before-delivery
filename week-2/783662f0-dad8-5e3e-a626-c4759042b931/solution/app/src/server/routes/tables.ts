import { Router } from 'express';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { requireIfMatch, setEtag } from '../http/conditional.js';
import { type SessionUser, requireUser } from '../http/session.js';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import type { GameKind } from '../../shared/domain.js';
import { requireCharacterOnServer, requireOwnCharacter } from '../domain/characters.js';
import * as chess from '../domain/chess.js';
import * as four from '../domain/four.js';
import * as tricks from '../domain/tricks.js';
import {
  type GameRow,
  IllegalMove,
  applyMove,
  endWithoutMove,
  loadGame,
  moveCopy,
  publishedPosition,
  publishTable,
  pushAnnouncement,
  replayGame,
  seatLabel,
  seatsOfTable,
  startGame,
  storeAndSettle,
  tableObject,
} from '../domain/games.js';
import { walletOf } from '../domain/ledger.js';
import { requireOwner, requirePlayable, scopeByServerId, scopeBySlug } from '../domain/servers.js';
import {
  checkCanMove,
  checkCanRematch,
  checkCanStandUp,
  checkCanStart,
  loadTable,
  lockTable,
  lowestFreeSeat,
  markSeated,
  restateAfterSeatChange,
  tableEtag,
} from '../domain/tables.js';
import { filterRecordHands } from '../domain/visibility.js';
import { withinOneTile } from '../domain/world.js';
import { instant } from '../util.js';
import { FieldErrors, checkStake, checkTurnSeconds, onlyFields } from '../validate.js';
import { body, created, ok, queryString, route } from './helpers.js';

export const tableRoutes = Router();

interface Located {
  readonly table: NonNullable<Awaited<ReturnType<typeof loadTable>>>;
  readonly scope: Awaited<ReturnType<typeof scopeByServerId>>;
}

async function locate(id: string, user: SessionUser): Promise<Located> {
  const table = await loadTable(id);
  if (table === null) throw fail('not_found');
  const scope = await scopeByServerId(table.server_id, user);
  return { table, scope };
}

tableRoutes.get(
  '/tables/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    setEtag(res, tableEtag(located.table));
    ok(res, await tableObject(located.table, user.id));
  }),
);

tableRoutes.patch(
  '/tables/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requireOwner(located.scope);
    onlyFields(body(req), ['stake', 'turn_seconds']);
    requireIfMatch(req, tableEtag(located.table));

    const taken = await one<{ seat: number }>('SELECT seat FROM seats WHERE table_id = $1 LIMIT 1', [
      located.table.id,
    ]);
    if (taken !== null) throw fail('table_in_use');

    const errors = new FieldErrors();
    const stake = checkStake(errors, body(req).stake);
    const turnSeconds = checkTurnSeconds(errors, body(req).turn_seconds);
    errors.throwIfAny();

    /* The If-Match check and the write are one step: the update applies only to the revision the
       caller matched, so of two writers holding one ETag exactly one wins and the other gets 412. */
    const written = await query(
      `UPDATE game_tables SET stake = $2, turn_seconds = $3, revision = revision + 1
        WHERE id = $1 AND revision = $4 RETURNING id`,
      [located.table.id, stake, turnSeconds, located.table.revision],
    );
    if (written.length === 0) {
      const current = await loadTable(located.table.id);
      if (current === null) throw fail('not_found');
      throw fail('precondition_failed', { etag: tableEtag(current) });
    }
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    await publishTable(updated.id);
    setEtag(res, tableEtag(updated));
    ok(res, await tableObject(updated, user.id));
  }),
);

/* Seats. */

tableRoutes.post(
  '/tables/:id/seats',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id']);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if (!withinOneTile(character.x, character.y, located.table.x, located.table.y)) {
      throw fail('too_far', { message: COPY.tooFar });
    }

    const wallet = await walletOf(character.id);
    if (wallet.available < located.table.stake) throw fail('insufficient_coins');

    /* Exactly one claim wins the last free seat; the rest get table_full. */
    const seat = await tx(async (client) => {
      const table = await lockTable(client, located.table.id);
      const held = await client.query<{ seat: number; character_id: string; user_id: string }>(
        `SELECT s.seat, s.character_id, c.user_id FROM seats s
           JOIN characters c ON c.id = s.character_id
          WHERE s.table_id = $1`,
        [table.id],
      );
      if (held.rows.some((row) => row.user_id === user.id)) throw fail('already_seated');
      const elsewhere = await client.query<{ table_id: string }>(
        'SELECT table_id FROM seats WHERE character_id = $1',
        [character.id],
      );
      if (elsewhere.rowCount !== 0) throw fail('already_seated');

      const free = lowestFreeSeat(
        table.game,
        held.rows.map((row) => row.seat),
      );
      if (free === null) throw fail('table_full', { message: COPY.tableFull });

      await client.query(
        'INSERT INTO seats (table_id, server_id, seat, character_id) VALUES ($1, $2, $3, $4)',
        [table.id, table.server_id, free, character.id],
      );
      await client.query('DELETE FROM spectators WHERE table_id = $1 AND character_id = $2', [
        table.id,
        character.id,
      ]);
      await markSeated(client, table);
      return free;
    });

    await publishTable(located.table.id);
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    created(res, {
      seat: { seat, label: seatLabel(updated.game, seat) },
      table: await tableObject(updated, user.id),
      announcement: copy.seated(updated.name, seatLabel(updated.game, seat)),
    });
  }),
);

tableRoutes.delete(
  '/tables/:id/seats/:characterId',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      req.params.characterId,
      user.id,
    );

    await tx(async (client) => {
      const table = await lockTable(client, located.table.id);
      const seat = await client.query<{ seat: number }>(
        'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
        [table.id, character.id],
      );
      if (seat.rowCount === 0) throw fail('not_found');
      checkCanStandUp(table.state);
      await client.query('DELETE FROM seats WHERE table_id = $1 AND character_id = $2', [
        table.id,
        character.id,
      ]);
      await restateAfterSeatChange(client, table);
    });

    await publishTable(located.table.id);
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    ok(res, await tableObject(updated, user.id));
  }),
);

/* Spectators. */

tableRoutes.post(
  '/tables/:id/spectators',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id']);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if (!withinOneTile(character.x, character.y, located.table.x, located.table.y)) {
      throw fail('too_far', { message: COPY.tooFar });
    }
    const seated = await one<{ seat: number }>(
      'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
      [located.table.id, character.id],
    );
    if (seated !== null) throw fail('already_seated');

    await query(
      `INSERT INTO spectators (table_id, server_id, character_id) VALUES ($1, $2, $3)
       ON CONFLICT (table_id, character_id) DO NOTHING`,
      [located.table.id, located.scope.server.id, character.id],
    );
    await publishTable(located.table.id);
    created(res, {
      table: await tableObject(located.table, user.id),
      announcement: copy.watching(located.table.name),
    });
  }),
);

tableRoutes.delete(
  '/tables/:id/spectators/:characterId',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      req.params.characterId,
      user.id,
    );
    await query('DELETE FROM spectators WHERE table_id = $1 AND character_id = $2', [
      located.table.id,
      character.id,
    ]);
    await publishTable(located.table.id);
    ok(res, await tableObject(located.table, user.id));
  }),
);

/* Starting, moving, forfeiting and rematches. */

tableRoutes.post(
  '/tables/:id/start',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id']);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    await tx(async (client) => {
      const table = await lockTable(client, located.table.id);
      const seat = await client.query<{ seat: number }>(
        'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
        [table.id, character.id],
      );
      if (seat.rowCount === 0) throw fail('not_seated');
      checkCanStart(table.state);
      await startGame(client, table, located.scope.server.season);
    });

    await publishTable(located.table.id);
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    ok(res, await tableObject(updated, user.id));
  }),
);

tableRoutes.get(
  '/tables/:id/legal-moves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    const characterId = queryString(req, 'character_id') ?? '';
    const character = await requireCharacterOnServer(located.scope.server.id, characterId);
    const seat = await one<{ seat: number }>(
      'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
      [located.table.id, character.id],
    );
    const game = located.table.game_id === null ? null : await loadGame(located.table.game_id);
    if (
      seat === null ||
      character.user_id !== user.id ||
      game === null ||
      game.state !== 'in_play' ||
      game.to_move_seat !== seat.seat
    ) {
      throw fail('not_your_turn');
    }
    ok(res, { moves: legalMovesFor(game, seat.seat) });
  }),
);

function legalMovesFor(game: GameRow, seat: number): string[] {
  if (game.game === 'chess') {
    return chess.legalMoves(chess.parseFen((game.position as { fen: string }).fen));
  }
  if (game.game === 'four') {
    return four.legalDrops((game.position as { rows: string[] }).rows);
  }
  const state = game.position as {
    hands: string[][];
    trick: { seat: number; card: string }[];
    led_suit: string | null;
    tricks_won: number[];
    leader: number;
  };
  return tricks.legalPlays(
    {
      hands: state.hands,
      trick: state.trick,
      ledSuit: state.led_suit as tricks.TricksState['ledSuit'],
      tricksWon: state.tricks_won,
      leader: state.leader,
    },
    seat,
  );
}

type MoveOutcome =
  | {
      readonly kind: 'expired';
      readonly gameId: string;
      readonly tableId: string;
      readonly endAnnouncement: string;
    }
  | {
      readonly kind: 'applied';
      readonly announcement: string;
      readonly endAnnouncement: string | null;
      readonly gameId: string;
      readonly finished: boolean;
      readonly tableId: string;
    };

tableRoutes.post(
  '/tables/:id/moves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id', 'turn', 'move']);

    const turn = body(req).turn;
    const move = body(req).move;
    if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) {
      throw fail('validation', {
        fields: { turn: 'Use the number of moves already accepted.' },
      });
    }
    if (typeof move !== 'string' || move === '') {
      throw fail('validation', { fields: { move: 'Send a move.' } });
    }

    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const apply = async (): Promise<MoveOutcome> =>
      tx(async (client) => {
        const table = await lockTable(client, located.table.id);
        const seat = await client.query<{ seat: number }>(
          'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
          [table.id, character.id],
        );
        if (seat.rowCount === 0) throw fail('not_seated');
        checkCanMove(table.state);

        const games = await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [
          table.game_id,
        ]);
        const game = games.rows[0];
        if (game === undefined || game.state !== 'in_play') throw fail('game_not_in_play');

        if (game.deadline !== null && Date.now() >= game.deadline.getTime()) {
          const ended = await endWithoutMove(
            client,
            table,
            game,
            'timeout',
            game.to_move_seat,
            game.deadline,
          );
          return {
            kind: 'expired',
            gameId: ended.game.id,
            tableId: table.id,
            endAnnouncement: ended.game.result?.text ?? '',
          };
        }
        if (game.moves.length !== turn) throw fail('stale_turn');

        const result = await applyMove(client, table, game, seat.rows[0].seat, move);
        return {
          kind: 'applied',
          announcement: result.announcement,
          endAnnouncement: result.endAnnouncement,
          gameId: result.game.id,
          finished: result.game.state === 'finished',
          tableId: table.id,
        };
      });

    let outcome: MoveOutcome;
    try {
      outcome = await apply();
    } catch (error) {
      if (error instanceof IllegalMove) throw fail('illegal_move', { message: error.message });
      throw error;
    }

    await publishTable(outcome.tableId);

    if (outcome.kind === 'expired') {
      await pushAnnouncement(located.scope.server.id, outcome.tableId, outcome.endAnnouncement);
      await storeAndSettle(outcome.gameId);
      throw fail('turn_expired');
    }

    if (outcome.endAnnouncement !== null) {
      await pushAnnouncement(located.scope.server.id, outcome.tableId, outcome.endAnnouncement);
    }
    if (outcome.finished) await storeAndSettle(outcome.gameId);

    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    ok(res, {
      announcement: outcome.announcement,
      table: await tableObject(updated, user.id),
    });
  }),
);

tableRoutes.post(
  '/tables/:id/forfeit',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id']);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const outcome = await tx(async (client) => {
      const table = await lockTable(client, located.table.id);
      const seat = await client.query<{ seat: number }>(
        'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
        [table.id, character.id],
      );
      if (seat.rowCount === 0) throw fail('not_seated');
      checkCanMove(table.state);
      const games = await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [
        table.game_id,
      ]);
      const game = games.rows[0];
      if (game === undefined || game.state !== 'in_play') throw fail('game_not_in_play');
      return endWithoutMove(client, table, game, 'forfeit', seat.rows[0].seat);
    });

    await publishTable(located.table.id);
    await pushAnnouncement(
      located.scope.server.id,
      located.table.id,
      outcome.game.result?.text ?? '',
    );
    await storeAndSettle(outcome.game.id);
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    ok(res, await tableObject(updated, user.id));
  }),
);

tableRoutes.post(
  '/tables/:id/rematch',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locate(req.params.id, user);
    requirePlayable(located.scope.server);
    onlyFields(body(req), ['character_id']);
    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const started = await tx(async (client) => {
      const table = await lockTable(client, located.table.id);
      const seat = await client.query<{ seat: number }>(
        'SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2',
        [table.id, character.id],
      );
      if (seat.rowCount === 0) throw fail('not_seated');
      checkCanRematch(table.state);

      const wallet = await walletOf(character.id, client);
      if (wallet.available < table.stake) throw fail('insufficient_coins');

      await client.query(
        `INSERT INTO rematch_offers (table_id, server_id, character_id) VALUES ($1, $2, $3)
         ON CONFLICT (table_id, character_id) DO NOTHING`,
        [table.id, table.server_id, character.id],
      );

      const seats = await seatsOfTable(table.id, client);
      const offers = await client.query<{ character_id: string }>(
        'SELECT character_id FROM rematch_offers WHERE table_id = $1',
        [table.id],
      );
      const everyone = seats.every((entry) =>
        offers.rows.some((offer) => offer.character_id === entry.character_id),
      );
      if (!everyone) return false;

      /* In a rematch the two-seat games swap seats. */
      if (seats.length === 2) {
        await client.query('DELETE FROM seats WHERE table_id = $1', [table.id]);
        for (const entry of seats) {
          await client.query(
            'INSERT INTO seats (table_id, server_id, seat, character_id) VALUES ($1, $2, $3, $4)',
            [table.id, table.server_id, entry.seat === 1 ? 2 : 1, entry.character_id],
          );
        }
      }
      await startGame(client, table, located.scope.server.season);
      return true;
    });

    await publishTable(located.table.id);
    if (started) {
      await pushAnnouncement(located.scope.server.id, located.table.id, COPY.rematchStarted);
    } else {
      await pushAnnouncement(
        located.scope.server.id,
        located.table.id,
        copy.rematchOffered(character.name),
      );
    }
    const updated = await loadTable(located.table.id);
    if (updated === null) throw fail('not_found');
    ok(res, await tableObject(updated, user.id));
  }),
);

/* Game records, replays and history. */

tableRoutes.get(
  '/games/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const game = await requireGame(req.params.id, user);
    const table = await loadTable(game.table_id);
    const seat = await viewerSeat(game, user.id);
    const filtered = filterRecordHands(
      {
        dealt: game.hands,
        remaining: null,
        seed: game.seed === null ? null : Number(game.seed),
        handOver: game.state === 'finished',
      },
      { seat },
    );
    ok(res, {
      id: game.id,
      table_id: game.table_id,
      table_name: table?.name ?? '',
      game: game.game,
      seats: game.seats.map((entry) => ({
        seat: entry.seat,
        label: seatLabel(game.game, entry.seat),
        character: { id: entry.character_id, name: entry.name },
      })),
      moves: game.moves,
      position: publishedPosition(game),
      result: game.result,
      settled: game.settled,
      started_at: instant(game.started_at),
      finished_at: game.finished_at === null ? null : instant(game.finished_at),
      seed: filtered.seed,
      hands: filtered.hands,
    });
  }),
);

tableRoutes.get(
  '/games/:id/replay',
  route(async (req, res) => {
    const user = await requireUser(req);
    const game = await requireGame(req.params.id, user);
    const replayed = replayGame(game);
    const stored = { position: publishedPosition(game), result: game.result };
    ok(res, {
      game_id: game.id,
      stored,
      replayed: { position: replayed.position, result: replayed.result },
      match: JSON.stringify(stored) === JSON.stringify(replayed),
    });
  }),
);

tableRoutes.get(
  '/games/:id/moves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const game = await requireGame(req.params.id, user);
    ok(res, {
      moves: game.moves.map((move, index) => ({
        n: index + 1,
        move,
        copy: moveCopy(game, index),
      })),
    });
  }),
);

tableRoutes.get(
  '/servers/:slug/games',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const search = (queryString(req, 'q') ?? '').trim().toLowerCase();
    const page = Math.max(1, Number(queryString(req, 'page') ?? '1') || 1);
    const pageSize = 20;

    const rows = await query<{
      id: string;
      game: GameKind;
      seats: { seat: number; character_id: string; name: string }[];
      result: { text: string } | null;
      finished_at: Date;
      table_name: string;
    }>(
      `SELECT g.id, g.game, g.seats, g.result, g.finished_at, t.name AS table_name
         FROM games g JOIN game_tables t ON t.id = g.table_id
        WHERE g.server_id = $1 AND g.settled = true
        ORDER BY g.finished_at DESC, g.id DESC`,
      [scope.server.id],
    );

    const matched = rows.filter((row) => {
      if (search === '') return true;
      if (row.table_name.toLowerCase().includes(search)) return true;
      return row.seats.some((seat) => seat.name.toLowerCase().includes(search));
    });

    ok(res, {
      games: matched.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
        id: row.id,
        table_name: row.table_name,
        game: row.game,
        players: row.seats.map((seat) => seat.name),
        result_text: row.result?.text ?? '',
        finished_at: instant(row.finished_at),
      })),
      total: matched.length,
      page,
      page_size: pageSize,
    });
  }),
);

async function requireGame(id: string, user: SessionUser): Promise<GameRow> {
  const game = await loadGame(id);
  if (game === null) throw fail('not_found');
  await scopeByServerId(game.server_id, user);
  return game;
}

async function viewerSeat(game: GameRow, userId: string): Promise<number | null> {
  for (const entry of game.seats) {
    const owner = await one<{ user_id: string }>('SELECT user_id FROM characters WHERE id = $1', [
      entry.character_id,
    ]);
    if (owner?.user_id === userId) return entry.seat;
  }
  return null;
}
