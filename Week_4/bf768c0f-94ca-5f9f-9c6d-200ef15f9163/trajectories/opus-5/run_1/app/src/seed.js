/**
 * The seed.  Run once at start-up and idempotently: every row carries an
 * identifier derived from a stable key, so a restart duplicates nothing.
 */

import { START_FEN, playMove, terminalState, positionKey } from './chess.js';
import { houseMove } from './house.js';
import { openingFor } from './record.js';
import { derivedId, transaction } from './db.js';
import { hashPassword } from './security.js';
import { DEMO_PASSWORD } from './config.js';

const MEMBERS = [
  { username: 'mira_kade', rating: 1480, rated_games: 42, role: 'administrator', avatar: 'avatar_01' },
  { username: 'tobin_reyes', rating: 1515, rated_games: 37, role: 'member', avatar: 'avatar_02' },
  { username: 'wren_oyelaran', rating: 2412, rated_games: 64, role: 'member', avatar: 'avatar_03' },
  { username: 'jules_amari', rating: 1190, rated_games: 6, role: 'member', avatar: 'avatar_04' },
  { username: 'nadia_serrano', rating: 108, rated_games: 31, role: 'member', avatar: 'avatar_05' },
  { username: 'ivo_lindqvist', rating: 112, rated_games: 33, role: 'member', avatar: 'avatar_06' },
];

const memberId = (username) => derivedId(`member:${username}`);
const clubId = (slug) => derivedId(`club:${slug}`);
const gameId = (key) => derivedId(`game:${key}`);

// A Caro-Kann smothered mate: White wins by checkmate.
const FINISHED_LINE = ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'b8d7', 'd1e2', 'g8f6', 'e4d6'];
// An Italian Game, five moves each, White to move.
const HALL_LINE = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3', 'd7d6'];
// A Slav Defence inside the Quiet Room.
const QUIET_LINE = ['d2d4', 'd7d5', 'c2c4', 'c7c6'];

function replay(line, startFen = START_FEN) {
  let fen = startFen;
  const moves = [];
  for (const uci of line) {
    const played = playMove(fen, uci);
    moves.push(played);
    fen = played.fen;
  }
  return { fen, moves, opening: openingFor(line) };
}

async function seedMembers(client) {
  const hash = hashPassword(DEMO_PASSWORD);
  for (const member of MEMBERS) {
    await client.query(
      `insert into members (id, username, email, password_hash, rating, rated_games, avatar_key, role, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() - interval '200 days')
       on conflict (id) do nothing`,
      [
        memberId(member.username), member.username, `${member.username}@example.com`,
        hash, member.rating, member.rated_games, member.avatar, member.role,
      ],
    );
  }
}

async function seedClubs(client) {
  await client.query(
    `insert into clubs (id, name, slug, private) values ($1, 'Open Hall', 'open-hall', false)
     on conflict (id) do nothing`,
    [clubId('open-hall')],
  );
  await client.query(
    `insert into clubs (id, name, slug, private) values ($1, 'Quiet Room', 'quiet-room', true)
     on conflict (id) do nothing`,
    [clubId('quiet-room')],
  );

  const open = clubId('open-hall');
  for (const member of MEMBERS) {
    await client.query(
      `insert into club_memberships (club_id, member_id, role, banned) values ($1, $2, $3, false)
       on conflict (club_id, member_id) do nothing`,
      [open, memberId(member.username), member.username === 'mira_kade' ? 'owner' : 'member'],
    );
  }

  const quiet = clubId('quiet-room');
  const quietRoster = [
    ['mira_kade', 'owner', false],
    ['tobin_reyes', 'moderator', false],
    ['jules_amari', 'member', false],
    ['nadia_serrano', 'member', true],
  ];
  for (const [username, role, banned] of quietRoster) {
    await client.query(
      `insert into club_memberships (club_id, member_id, role, banned) values ($1, $2, $3, $4)
       on conflict (club_id, member_id) do nothing`,
      [quiet, memberId(username), role, banned],
    );
  }
}

async function insertMoves(client, id, moves) {
  for (let i = 0; i < moves.length; i++) {
    await client.query(
      `insert into moves (id, game_id, ply, uci, san, fen_after, announcement, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 hour' + ($3::int * interval '1 minute'))
       on conflict (game_id, ply) do nothing`,
      [derivedId(`move:${id}:${i + 1}`), id, i + 1, moves[i].uci, moves[i].san, moves[i].fen, moves[i].announcement],
    );
  }
}

async function seedFinishedGame(client) {
  const id = gameId('mira-wren-finished');
  const { fen, moves, opening } = replay(FINISHED_LINE);
  const state = terminalState(fen, [positionKey(START_FEN), ...moves.map((m) => positionKey(m.fen))]);
  if (state.reason !== 'checkmate' || state.result !== '1-0') {
    throw new Error(`the seeded finished game must end in checkmate 1-0, got ${state.reason} ${state.result}`);
  }
  const existing = await client.query('select 1 from games where id = $1', [id]);
  if (existing.rowCount === 0) {
    await client.query(
      `insert into games (id, white_id, black_id, club_id, rated, level, fen, start_fen, status, result,
         end_reason, opening, created_at, last_move_at, finished_at,
         white_rating_before, black_rating_before, white_rated_games_before, black_rated_games_before)
       values ($1, $2, $3, null, true, null, $4, $5, 'finished', '1-0', 'checkmate', $6,
         now() - interval '30 days', now() - interval '30 days', now() - interval '30 days',
         1460, 2422, 41, 63)`,
      [id, memberId('mira_kade'), memberId('wren_oyelaran'), fen, START_FEN, opening],
    );
  }
  await insertMoves(client, id, moves);
}

async function seedInProgressGames(client) {
  const hall = gameId('mira-tobin-hall');
  const hallLine = replay(HALL_LINE);
  if ((await client.query('select 1 from games where id = $1', [hall])).rowCount === 0) {
    await client.query(
      `insert into games (id, white_id, black_id, club_id, rated, level, fen, start_fen, status, result, opening,
         created_at, last_move_at)
       values ($1, $2, $3, $4, true, null, $5, $6, 'in_progress', '*', $7,
         now() - interval '40 minutes', now() - interval '20 minutes')`,
      [hall, memberId('mira_kade'), memberId('tobin_reyes'), clubId('open-hall'), hallLine.fen, START_FEN, hallLine.opening],
    );
  }
  await insertMoves(client, hall, hallLine.moves);

  const quiet = gameId('tobin-jules-quiet');
  const quietLine = replay(QUIET_LINE);
  if ((await client.query('select 1 from games where id = $1', [quiet])).rowCount === 0) {
    await client.query(
      `insert into games (id, white_id, black_id, club_id, rated, level, fen, start_fen, status, result, opening,
         created_at, last_move_at)
       values ($1, $2, $3, $4, true, null, $5, $6, 'in_progress', '*', $7,
         now() - interval '35 minutes', now() - interval '15 minutes')`,
      [quiet, memberId('tobin_reyes'), memberId('jules_amari'), clubId('quiet-room'), quietLine.fen, START_FEN, quietLine.opening],
    );
  }
  await insertMoves(client, quiet, quietLine.moves);

  // One unrated house game: jules plays White against the house at steady.
  const house = gameId('jules-house-steady');
  const opening = playMove(START_FEN, 'e2e4');
  const reply = playMove(opening.fen, houseMove(opening.fen, 'steady'));
  const houseMoves = [opening, reply];
  if ((await client.query('select 1 from games where id = $1', [house])).rowCount === 0) {
    await client.query(
      `insert into games (id, white_id, black_id, club_id, rated, level, fen, start_fen, status, result, opening,
         created_at, last_move_at)
       values ($1, $2, null, null, false, 'steady', $3, $4, 'in_progress', '*', $5,
         now() - interval '25 minutes', now() - interval '10 minutes')`,
      [house, memberId('jules_amari'), reply.fen, START_FEN, openingFor(houseMoves.map((m) => m.uci))],
    );
  }
  await insertMoves(client, house, houseMoves);

  return { hall, quiet, house };
}

async function seedChat(client, hall, quiet) {
  const messages = [
    [hall, 'mira_kade', 'Good luck, Tobin. Take your time.', 1],
    [hall, 'tobin_reyes', 'And to you. I will think on this one.', 2],
    [quiet, 'tobin_reyes', 'Quiet room, quiet game.', 1],
    [quiet, 'jules_amari', 'My favourite kind. Your move.', 2],
  ];
  for (const [game, username, text, order] of messages) {
    await client.query(
      `insert into chat_messages (id, game_id, member_id, text, created_at)
       values ($1, $2, $3, $4, now() - interval '30 minutes' + ($5::int * interval '1 minute'))
       on conflict (id) do nothing`,
      [derivedId(`chat:${game}:${order}`), game, memberId(username), text, order],
    );
  }
}

async function seedChallengeAndBlock(client) {
  await client.query(
    `insert into challenges (id, from_id, to_id, club_id, rated, colour, status, created_at)
     values ($1, $2, $3, null, true, 'Black', 'pending', now() - interval '2 hours')
     on conflict (id) do nothing`,
    [derivedId('challenge:mira-tobin'), memberId('mira_kade'), memberId('tobin_reyes')],
  );
  await client.query(
    `insert into notifications (id, member_id, kind, game_id, actor_id, read, created_at)
     values ($1, $2, 'challenge', null, $3, false, now() - interval '2 hours')
     on conflict (id) do nothing`,
    [derivedId('notification:challenge:mira-tobin'), memberId('tobin_reyes'), memberId('mira_kade')],
  );
  await client.query(
    `insert into blocks (blocker_id, blocked_id) values ($1, $2)
     on conflict (blocker_id, blocked_id) do nothing`,
    [memberId('nadia_serrano'), memberId('jules_amari')],
  );
}

export async function seed() {
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(727_273_001)');
    await seedMembers(client);
    await seedClubs(client);
    await seedFinishedGame(client);
    const { hall, quiet } = await seedInProgressGames(client);
    await seedChat(client, hall, quiet);
    await seedChallengeAndBlock(client);
    const counts = await client.query(
      `select
         (select count(*) from members) as members,
         (select count(*) from clubs) as clubs,
         (select count(*) from games) as games,
         (select count(*) from moves) as moves,
         (select count(*) from chat_messages) as chat,
         (select count(*) from challenges) as challenges`,
    );
    return counts.rows[0];
  });
}

export const SEED_MEMBERS = MEMBERS;
