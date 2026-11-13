import pg from "pg";
import type { Piece, PieceId, Seat, Format, QueenState } from "../shared/rules.js";
import { openingLayout, strikerBaselineY, PIECE_IDS } from "../shared/rules.js";

/** Player rows and helpers over the schema in db.ts. */
export interface PlayerRow {
  id: string;
  name: string;
  avatar: number;
  chosen: boolean;
  email: string | null;
  rating: number;
  rd: number;
  volatility: number;
  ranked_games: number;
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export async function findPlayerById(client: pg.PoolClient, id: string): Promise<PlayerRow | null> {
  const res = await client.query<PlayerRow>(
    "select id, name, avatar, chosen, email, rating, rd, volatility, ranked_games from players where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

export async function findPlayerByName(
  client: pg.PoolClient,
  name: string
): Promise<PlayerRow | null> {
  const res = await client.query<PlayerRow>(
    "select id, name, avatar, chosen, email, rating, rd, volatility, ranked_games from players where name_lower = $1",
    [name.toLowerCase()]
  );
  return res.rows[0] ?? null;
}

export async function createGuest(client: pg.PoolClient): Promise<PlayerRow> {
  const id = newId("p");
  // A random free 4-digit number, retried on the rare collision.
  let name = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `Guest-${digits}`;
    const taken = await client.query("select 1 from players where name_lower = $1", [
      candidate.toLowerCase(),
    ]);
    if (taken.rows.length === 0) {
      name = candidate;
      break;
    }
  }
  if (name === "") name = `Guest-${Date.now() % 10000}`;
  await client.query(
    "insert into players (id, name, name_lower, avatar, chosen) values ($1, $2, $3, 1, false)",
    [id, name, name.toLowerCase()]
  );
  const row = await findPlayerById(client, id);
  if (row === null) throw new Error("guest creation failed");
  return row;
}



export async function chalkBalance(client: pg.PoolClient, playerId: string): Promise<number> {
  const res = await client.query<{ sum: string }>(
    "select coalesce(sum(delta), 0) as sum from ledger where account = 'player' and player_id = $1",
    [playerId]
  );
  return Number(res.rows[0].sum);
}

export async function ownedItems(client: pg.PoolClient, playerId: string): Promise<string[]> {
  const res = await client.query<{ item_id: string }>(
    "select item_id from owned_items where player_id = $1",
    [playerId]
  );
  return res.rows.map((r) => r.item_id);
}

export async function equippedRow(
  client: pg.PoolClient,
  playerId: string
): Promise<{ striker: string; board: string; coins: string }> {
  const res = await client.query<{ striker: string; board: string; coins: string }>(
    "select striker, board, coins from equipped where player_id = $1",
    [playerId]
  );
  if (res.rows[0] !== undefined) return res.rows[0];
  await client.query(
    "insert into equipped (player_id, striker, board, coins) values ($1, 'striker-ply', 'board-ply', 'coins-ivory') on conflict do nothing",
    [playerId]
  );
  return { striker: "striker-ply", board: "board-ply", coins: "coins-ivory" };
}

/** One chalk movement: two ledger entries with one movement id, summing to zero. */
export async function addChalk(
  client: pg.PoolClient,
  playerId: string,
  delta: number,
  reason: string,
  itemId: string | null
): Promise<void> {
  if (delta === 0) return;
  const movementId = newId("m");
  await client.query(
    "insert into ledger (movement_id, account, player_id, delta, reason, item_id) values ($1, 'player', $2, $3, $4, $5), ($1, 'house', null, $6, $4, $5)",
    [movementId, playerId, delta, reason, itemId, -delta]
  );
}

// ---------------------------------------------------------------------------
// Match rows.
// ---------------------------------------------------------------------------

export interface MatchRow {
  id: string;
  mode: "private" | "casual" | "ranked";
  format: Format;
  status: "waiting" | "active" | "completed" | "forfeit" | "abandoned";
  board: number;
  turn: Seat;
  phase: string;
  shot_seq: number;
  break_attempt: number | null;
  queen_state: string;
  queen_seat: number | null;
  scores: [number, number];
  dues: [number, number];
  timeouts: [number, number];
  white_seat: Seat;
  turn_deadline: Date | null;
  winner_seat: number | null;
  end_reason: string | null;
  room_code: string | null;
  rematch_offer_seat: number | null;
  rematch_deadline: Date | null;
  first_breaker: Seat | null;
}

export interface SeatRow {
  seat: Seat;
  player_id: string;
  name: string;
  avatar: number;
  striker_skin: string;
  connected: boolean;
  ready: boolean;
}

export async function loadMatchRow(client: pg.PoolClient, id: string): Promise<MatchRow | null> {
  const res = await client.query(
    `select id, mode, format, status, board, turn, phase, shot_seq, break_attempt,
       queen_state, queen_seat, scores, dues, timeouts, white_seat, turn_deadline,
       winner_seat, end_reason, room_code, rematch_offer_seat, rematch_deadline, first_breaker
     from matches where id = $1`,
    [id]
  );
  const r = res.rows[0];
  if (r === undefined) return null;
  return {
    ...r,
    scores: JSON.parse(r.scores) as [number, number],
    dues: JSON.parse(r.dues) as [number, number],
    timeouts: JSON.parse(r.timeouts) as [number, number],
  };
}

export async function loadSeats(client: pg.PoolClient, matchId: string): Promise<SeatRow[]> {
  const res = await client.query(
    `select s.seat, s.player_id, p.name, p.avatar, s.striker_skin, s.connected, s.ready
     from match_seats s join players p on p.id = s.player_id
     where s.match_id = $1 order by s.seat`,
    [matchId]
  );
  return res.rows.map((r) => ({ ...r, seat: r.seat as Seat }));
}

export async function loadPieces(client: pg.PoolClient, matchId: string): Promise<Piece[]> {
  const res = await client.query<{ pieces: string }>(
    "select pieces from boards where match_id = $1 and board_number = (select max(board_number) from boards where match_id = $1)",
    [matchId]
  );
  const raw = res.rows[0]?.pieces;
  if (raw === undefined) return [];
  return JSON.parse(raw) as Piece[];
}

export async function savePieces(
  client: pg.PoolClient,
  matchId: string,
  boardNumber: number,
  pieces: Piece[]
): Promise<void> {
  await client.query(
    `insert into boards (match_id, board_number, pieces) values ($1, $2, $3)
     on conflict (match_id, board_number) do update set pieces = excluded.pieces`,
    [matchId, boardNumber, JSON.stringify(pieces)]
  );
}

export async function loadQueen(client: pg.PoolClient, matchId: string): Promise<QueenState> {
  const res = await client.query<{ queen_state: string; queen_seat: number | null }>(
    "select queen_state, queen_seat from matches where id = $1",
    [matchId]
  );
  const r = res.rows[0];
  if (r === undefined) return { state: "board", seat: null };
  return { state: r.queen_state as QueenState["state"], seat: (r.queen_seat ?? null) as Seat | null };
}

/** The full ordered piece list from a partial grading payload. */
export function fullPiecesFromPartial(partial: { id: string; x: number; y: number }[]): Piece[] {
  const listed = new Map(partial.map((p) => [p.id, p]));
  const pieces: Piece[] = [];
  for (const id of PIECE_IDS) {
    if (id === "striker") continue;
    const given = listed.get(id);
    if (given !== undefined) {
      pieces.push({ id, x: given.x, y: given.y, state: "board", pocketedBy: null });
    } else {
      pieces.push({ id, x: 0, y: 0, state: "pocketed", pocketedBy: null });
    }
  }
  return pieces;
}

