import { LAUNCH_SPEED, PIECE_IDS, isCoin } from "../shared/constants";
import { simulate } from "../shared/physics";
import type { Body } from "../shared/physics";
import { openingPieces, ownerOf } from "../shared/rules";
import { strikerSpot } from "../shared/shot";
import type { Format, MatchState, PieceId, PieceState, QueenState, Seat } from "../shared/types";
import { query, transaction } from "./db";
import { ApiError } from "./errors";
import { recordMovement } from "./ledger";
import { createRoomForMatch } from "./rooms";
import { insertMatch } from "./matches";
import type { Mode } from "./matches";
import { hashToken, newToken } from "./util";
import { uniqueViolation } from "./db";

/** The grading routes: they exist only when GRADING_KEY is set and are reached only with that key. */

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "INVALID_PAYLOAD");
  return value as Json;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function seatOrDefault(value: unknown, fallback: Seat): Seat {
  return value === 0 || value === 1 ? value : fallback;
}

export async function createPlayer(body: unknown): Promise<Json> {
  const input = object(body);
  if (typeof input.name !== "string" || input.name.length === 0) throw new ApiError(422, "NAME_INVALID");
  const email = typeof input.email === "string" ? input.email : null;
  const token = newToken();
  try {
    const id = await transaction(async (db) => {
      const made = await db.query(
        `INSERT INTO players (name, name_key, avatar, chosen, email, email_key, rating, rd, volatility, ranked_games)
         VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          input.name,
          (input.name as string).toLowerCase(),
          number(input.avatar, 1),
          email,
          email ? email.toLowerCase() : null,
          number(input.rating, 1500),
          number(input.rd, 350),
          number(input.volatility, 0.06),
          number(input.rankedGames, 0),
        ],
      );
      const playerId = made.rows[0].id as string;
      await db.query("INSERT INTO sessions (token_hash, player_id) VALUES ($1, $2)", [hashToken(token), playerId]);
      const chalk = number(input.chalk, 0);
      if (chalk > 0) await recordMovement(db, playerId, chalk, "grant");
      return playerId;
    });
    return { id, name: input.name, sessionCookie: token };
  } catch (error) {
    if (uniqueViolation(error)) throw new ApiError(409, "NAME_TAKEN");
    throw error;
  }
}

function boardFrom(input: Json, white: Seat, turn: Seat): { pieces: PieceState[]; queen: QueenState } {
  const queenInput = input.queen === undefined ? { state: "board", seat: null } : object(input.queen);
  const queen: QueenState = { state: queenInput.state as QueenState["state"], seat: (queenInput.seat as Seat | null) ?? null };
  const draft = { white };
  if (!Array.isArray(input.pieces)) return { pieces: openingPieces(turn), queen };
  const listed = new Map<string, Json>();
  for (const entry of input.pieces) listed.set(object(entry).id as string, object(entry));
  const pieces: PieceState[] = PIECE_IDS.map((id) => {
    if (id === "striker") return { id, x: 0, y: strikerSpot(turn, 0).y, state: "board", pocketedBy: null };
    const entry = listed.get(id);
    if (entry && entry.state !== "pocketed") {
      return { id, x: number(entry.x, 0), y: number(entry.y, 0), state: "board", pocketedBy: null };
    }
    const by = id === "queen" ? queen.seat : isCoin(id) ? ownerOf(draft, id) : null;
    return { id, x: null, y: null, state: "pocketed", pocketedBy: entry && (entry.pocketedBy === 0 || entry.pocketedBy === 1) ? entry.pocketedBy : by };
  });
  return { pieces, queen };
}

export async function createMatch(body: unknown): Promise<Json> {
  const input = object(body);
  const mode = input.mode as Mode;
  const format = (input.format === "classic" ? "classic" : "quick") as Format;
  const ids = input.players;
  if (!Array.isArray(ids) || ids.length !== 2) throw new ApiError(400, "INVALID_PAYLOAD");
  const white = seatOrDefault(input.white, 0);
  const turn = seatOrDefault(input.turn, white);
  const { pieces, queen } = boardFrom(input, white, turn);
  const pair = (value: unknown, fallback: number): [number, number] =>
    Array.isArray(value) && value.length === 2 ? [number(value[0], fallback), number(value[1], fallback)] : [fallback, fallback];
  const state: MatchState = {
    format,
    board: number(input.board, 1),
    scores: pair(input.scores, 0),
    white,
    turn,
    breakAttempt: input.breakAttempt === 1 || input.breakAttempt === 2 || input.breakAttempt === 3 ? input.breakAttempt : null,
    dues: pair(input.dues, 0),
    timeouts: pair(input.timeouts, 0),
    pieces,
    queen,
    finished: false,
    winnerSeat: null,
    endReason: null,
  };
  const seats = [String(ids[0]), String(ids[1])] as [string, string];
  const known = await query("SELECT id FROM players WHERE id = ANY($1)", [seats]).catch(() => []);
  if (known.length !== 2) throw new ApiError(404, "NOT_FOUND");
  return transaction(async (db) => {
    const id = await insertMatch(db, { mode, format, seats, status: "active", state, firstBreaker: white });
    const code = mode === "private" ? await createRoomForMatch(db, id, format, seats) : null;
    return { id, url: `/match/${id}`, code };
  });
}

export function simulateJson(body: unknown): Json {
  const input = object(body);
  if (!Array.isArray(input.pieces) || input.pieces.length > PIECE_IDS.length) throw new ApiError(400, "INVALID_PAYLOAD");
  const intent = input.intent === undefined ? null : object(input.intent);
  const bodies: Body[] = [];
  for (const raw of input.pieces) {
    const piece = object(raw);
    const id = piece.id as PieceId;
    if (!PIECE_IDS.includes(id)) throw new ApiError(400, "INVALID_PAYLOAD");
    if (intent && id === "striker") continue;
    bodies.push({ id, x: number(piece.x, 0), y: number(piece.y, 0), vx: number(piece.vx, 0), vy: number(piece.vy, 0) });
  }
  if (intent) {
    const seat = seatOrDefault(intent.seat, 0);
    const spot = strikerSpot(seat, number(intent.x, 0));
    const speed = LAUNCH_SPEED * number(intent.p, 0);
    bodies.push({ id: "striker", x: spot.x, y: spot.y, vx: speed * number(intent.dx, 0), vy: speed * number(intent.dy, 0) });
  }
  const result = simulate(bodies);
  return {
    events: result.events,
    frames: result.frames,
    final: result.final,
    durationSeconds: result.durationSeconds,
    maxSpeedAtRest: result.maxSpeedAtRest,
  };
}

