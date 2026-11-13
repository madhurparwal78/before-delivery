import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { conflict, unprocessable } from './errors.js';
import { addMovement, localAwardsToday } from './ledger.js';
import { fingerprint } from './shop.js';
import type { PlayerRow } from './players.js';
import { MODEL_VERSION, openingPieces, otherSeat } from '../shared/geometry.js';
import { matchOver, matchWinner } from '../shared/laws.js';
import { checkShot, playShot } from '../shared/shot.js';
import { localMatchAward } from '../shared/chalk.js';
import type { BoardState, Format, Seat } from '../shared/types.js';

export interface LocalShot {
  seat: Seat;
  x: number;
  dx: number;
  dy: number;
  p: number;
}

export interface LocalSubmission {
  format: Format;
  players: { name: string }[];
  shots: LocalShot[];
  resignedSeat: Seat | null;
  claimed: { winnerSeat: Seat; scores: [number, number] };
  modelVersion: string;
  idempotencyKey: string;
}

interface Replay {
  winnerSeat: Seat;
  scores: [number, number];
}

/** Replays a pass-and-play log from the opening layout with the shared model and laws. */
function replay(submission: LocalSubmission): Replay | null {
  const state: BoardState = {
    board: 1,
    turn: 0,
    whiteSeat: 0,
    breakAttempt: 1,
    pieces: openingPieces(),
    queen: { state: 'board', seat: null },
    dues: [0, 0],
    scores: [0, 0],
  };
  let finished: Seat | null = null;

  for (let index = 0; index < submission.shots.length; index += 1) {
    if (finished !== null) return null;
    const shot = submission.shots[index];
    if (shot.seat !== state.turn) return null;
    const intent = { seat: shot.seat, x: shot.x, dx: shot.dx, dy: shot.dy, p: shot.p };
    if (checkShot(state, shot.seat, intent) !== null) return null;
    const outcome = playShot(state, shot.seat, intent);
    state.turn = outcome.nextTurn;
    const boardOutcome = outcome.ruling.boardOutcome;
    if (boardOutcome === null) continue;
    state.scores[boardOutcome.winnerSeat] += boardOutcome.points;
    if (matchOver(submission.format, state.board, state.scores)) {
      finished = matchWinner(state.scores, boardOutcome.winnerSeat);
      continue;
    }
    const loser = otherSeat(boardOutcome.winnerSeat);
    state.board += 1;
    state.whiteSeat = loser;
    state.turn = loser;
    state.pieces = openingPieces();
    state.queen = { state: 'board', seat: null };
    state.dues = [0, 0];
    state.breakAttempt = 1;
  }

  if (submission.resignedSeat !== null) {
    if (finished !== null) return null;
    if (submission.resignedSeat !== state.turn) return null;
    finished = otherSeat(submission.resignedSeat);
  }
  if (finished === null) return null;
  return { winnerSeat: finished, scores: [state.scores[0], state.scores[1]] };
}

export async function recordLocalMatch(
  player: PlayerRow,
  submission: LocalSubmission,
): Promise<Record<string, unknown>> {
  const print = fingerprint({
    format: submission.format,
    players: submission.players,
    shots: submission.shots,
    resignedSeat: submission.resignedSeat,
    claimed: submission.claimed,
  });

  return transaction(async (client) => {
    await client.query('select id from players where id = $1 for update', [player.id]);
    const stored = await client.query<{ fingerprint: string; response: Record<string, unknown> }>(
      "select fingerprint, response from idempotency_keys where scope = 'local-match' and key = $1 and player_id = $2",
      [submission.idempotencyKey, player.id],
    );
    const existing = stored.rows[0];
    if (existing !== undefined) {
      if (existing.fingerprint !== print) throw conflict('IDEMPOTENCY_CONFLICT');
      return existing.response;
    }
    if (submission.modelVersion !== MODEL_VERSION) throw conflict('CLIENT_OUTDATED');

    const result = replay(submission);
    if (
      result === null ||
      result.winnerSeat !== submission.claimed.winnerSeat ||
      result.scores[0] !== submission.claimed.scores[0] ||
      result.scores[1] !== submission.claimed.scores[1]
    ) {
      throw unprocessable('RESULT_MISMATCH');
    }

    const matchId = randomUUID();
    const names = [submission.players[0].name, submission.players[1].name];
    await client.query(
      `insert into matches (id, mode, format, status, state, winner_seat, end_reason, ended_at)
       values ($1, 'local', $2, 'completed', $3, $4, $5, now())`,
      [
        matchId,
        submission.format,
        JSON.stringify({ names, scores: result.scores, shots: submission.shots.length }),
        result.winnerSeat,
        submission.resignedSeat === null ? 'played' : 'resigned',
      ],
    );
    await client.query(
      `insert into match_players (match_id, seat, player_id, name, opponent_name, score, opponent_score)
       values ($1, 0, $2, $3, $4, $5, $6)`,
      [matchId, player.id, names[0], names[1], result.scores[0], result.scores[1]],
    );

    const awarded = localMatchAward(await localAwardsToday(player.id));
    if (awarded > 0) await addMovement(client, player.id, awarded, 'local');

    const response = { matchId, chalkEarned: awarded };
    await client.query(
      `insert into idempotency_keys (scope, key, player_id, fingerprint, response)
       values ('local-match', $1, $2, $3, $4)`,
      [submission.idempotencyKey, player.id, print, JSON.stringify(response)],
    );
    return response;
  });
}
