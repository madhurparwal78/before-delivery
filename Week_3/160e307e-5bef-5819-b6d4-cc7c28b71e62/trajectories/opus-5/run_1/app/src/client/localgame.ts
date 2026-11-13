import type { MatchJson, PieceJson, ShotResultJson } from './api.js';
import { baselineY, openingPieces, otherSeat, round1 } from '../shared/geometry.js';
import { coinsLeft, matchOver, matchWinner } from '../shared/laws.js';
import { playShot } from '../shared/shot.js';
import type { BoardState, Format, Intent, Seat } from '../shared/types.js';

export interface LoggedShot {
  seat: Seat;
  x: number;
  dx: number;
  dy: number;
  p: number;
}

/** A pass-and-play match held on the device, ruled by the same shared model and laws. */
export class LocalGame {
  readonly format: Format;
  readonly names: [string, string];
  readonly shots: LoggedShot[] = [];
  readonly id = 'local';
  state: BoardState;
  status: 'active' | 'completed' | 'forfeit' = 'active';
  shotSeq = 0;
  winnerSeat: Seat | null = null;
  endReason: 'played' | 'resigned' | null = null;
  resignedSeat: Seat | null = null;
  boardPointsLine: string | null = null;

  constructor(format: Format, names: [string, string]) {
    this.format = format;
    this.names = names;
    this.state = {
      board: 1,
      turn: 0,
      whiteSeat: 0,
      breakAttempt: 1,
      pieces: openingPieces(),
      queen: { state: 'board', seat: null },
      dues: [0, 0],
      scores: [0, 0],
    };
  }

  play(intent: Intent): ShotResultJson {
    const seat = this.state.turn;
    const outcome = playShot(this.state, seat, intent);
    this.shots.push({ seat, x: intent.x, dx: intent.dx, dy: intent.dy, p: intent.p });
    this.shotSeq += 1;
    this.state.turn = outcome.nextTurn;
    const boardOutcome = outcome.ruling.boardOutcome;
    this.boardPointsLine = boardOutcome?.pointsLine ?? null;

    if (boardOutcome !== null) {
      this.state.scores[boardOutcome.winnerSeat] += boardOutcome.points;
      if (matchOver(this.format, this.state.board, this.state.scores)) {
        this.status = 'completed';
        this.endReason = 'played';
        this.winnerSeat = matchWinner(this.state.scores, boardOutcome.winnerSeat);
      } else {
        const loser = otherSeat(boardOutcome.winnerSeat);
        this.state.board += 1;
        this.state.whiteSeat = loser;
        this.state.turn = loser;
        this.state.pieces = openingPieces();
        this.state.queen = { state: 'board', seat: null };
        this.state.dues = [0, 0];
        this.state.breakAttempt = 1;
      }
    }

    return {
      shotSeq: this.shotSeq,
      seat,
      events: outcome.events,
      verdict: outcome.ruling.verdict,
      frames: outcome.frames,
      final: outcome.final,
      boardOutcome,
      match: this.json(),
    };
  }

  resign(): void {
    const seat = this.state.turn;
    this.resignedSeat = seat;
    this.winnerSeat = otherSeat(seat);
    this.status = 'forfeit';
    this.endReason = 'resigned';
  }

  json(): MatchJson {
    const pieces: PieceJson[] = [
      { id: 'striker', x: 0, y: round1(baselineY(this.state.turn)), state: 'board', pocketedBy: null },
      ...this.state.pieces.map((piece) => ({
        id: piece.id,
        x: piece.x === null ? null : round1(piece.x),
        y: piece.y === null ? null : round1(piece.y),
        state: piece.state,
        pocketedBy: piece.pocketedBy,
      })),
    ];
    return {
      id: this.id,
      mode: 'local',
      format: this.format,
      status: this.status,
      board: this.state.board,
      turn: this.state.turn,
      phase: this.status === 'active' ? 'aim' : 'match-over',
      shotSeq: this.shotSeq,
      breakAttempt: this.state.breakAttempt,
      seats: [0, 1].map((index) => {
        const seat = index as Seat;
        return {
          seat,
          playerId: null,
          name: this.names[seat],
          avatar: 1,
          color: seat === this.state.whiteSeat ? ('white' as const) : ('black' as const),
          score: this.state.scores[seat],
          coinsLeft: coinsLeft(this.state, seat),
          dues: this.state.dues[seat],
          timeouts: 0,
          connected: true,
          ready: true,
          strikerSkin: 'striker-ply',
        };
      }) as MatchJson['seats'],
      queen: this.state.queen,
      pieces,
      turnDeadline: null,
      turnRemainingMs: null,
      winnerSeat: this.winnerSeat,
      endReason: this.endReason,
      roomCode: null,
      boardPointsLine: this.boardPointsLine,
      ratingChange: [null, null],
      chalkEarned: [0, 0],
    };
  }
}
