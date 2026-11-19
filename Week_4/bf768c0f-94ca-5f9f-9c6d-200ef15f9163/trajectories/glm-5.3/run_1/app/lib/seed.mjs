import { query } from './db.mjs';
import { hashPassword } from './auth.mjs';
import { newId } from './auth.mjs';
import { parseFen, legalMoves, applyMove, toFen, statusOf, sqToName } from './chess.mjs';
import { sanFor, announcementFor, openingFor } from './san.mjs';
import { houseMove } from './house.mjs';
import { START_FEN } from './chess.mjs';

const PASSWORD = 'gambit-demo-pw-2026';

const MEMBERS = [
  { id: 'mem_mira_kade', username: 'mira_kade', rating: 1480, rated_games: 42, role: 'administrator' },
  { id: 'mem_tobin_reyes', username: 'tobin_reyes', rating: 1515, rated_games: 37, role: 'member' },
  { id: 'mem_wren_oyelaran', username: 'wren_oyelaran', rating: 2412, rated_games: 64, role: 'member' },
  { id: 'mem_jules_amari', username: 'jules_amari', rating: 1190, rated_games: 6, role: 'member' },
  { id: 'mem_nadia_serrano', username: 'nadia_serrano', rating: 108, rated_games: 31, role: 'member' },
  { id: 'mem_ivo_lindqvist', username: 'ivo_lindqvist', rating: 112, rated_games: 33, role: 'member' },
];

const uci = m => sqToName(m.from) + sqToName(m.to) + (m.promo || '');

// Plays a list of coordinate moves from a starting FEN, validating each one.
// Returns the rows for the moves table plus the final FEN.
function playMoves(startFen, uciList, startedMinutesAgo) {
  let pos = parseFen(startFen);
  let fen = startFen;
  const rows = [];
  for (let i = 0; i < uciList.length; i++) {
    const u = uciList[i];
    const legal = legalMoves(pos);
    const mv = legal.find(m => uci(m) === u);
    if (!mv) throw new Error(`Seed move ${u} is not legal in ${fen}`);
    const san = sanFor(fen, u);
    const ann = announcementFor(fen, u);
    const after = applyMove(pos, mv);
    rows.push({
      ply: i + 1, uci: u, san,
      fen_after: toFen(after),
      announcement: ann,
    });
    pos = after;
    fen = toFen(after);
  }
  return { rows, finalFen: fen, finalPos: pos };
}

export async function seed() {
  await seedHouseMember();
  // Members -------------------------------------------------------------
  const pwHash = hashPassword(PASSWORD);
  for (const m of MEMBERS) {
    await query(
      `INSERT INTO members (id, username, email, password_hash, rating, rated_games, role, view, piece_set_2d, piece_set_3d, theme, sound, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'flat','Classic','Marble','Forest',TRUE, now() - interval '90 days')
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.username, `${m.username}@example.com`, pwHash, m.rating, m.rated_games, m.role]
    );
  }

  // Clubs ----------------------------------------------------------------
  await query(
    `INSERT INTO clubs (id, name, slug, private) VALUES ('club_open_hall','Open Hall','open-hall',FALSE)
     ON CONFLICT (id) DO NOTHING`
  );
  await query(
    `INSERT INTO clubs (id, name, slug, private) VALUES ('club_quiet_room','Quiet Room','quiet-room',TRUE)
     ON CONFLICT (id) DO NOTHING`
  );

  // Open Hall: every member, mira_kade owner
  const openHallRoles = [
    ['mem_mira_kade', 'owner'],
    ['mem_tobin_reyes', 'member'],
    ['mem_wren_oyelaran', 'member'],
    ['mem_jules_amari', 'member'],
    ['mem_nadia_serrano', 'member'],
    ['mem_ivo_lindqvist', 'member'],
  ];
  for (const [memberId, role] of openHallRoles) {
    await query(
      `INSERT INTO club_memberships (club_id, member_id, role, banned) VALUES ('club_open_hall',$1,$2,FALSE)
       ON CONFLICT (club_id, member_id) DO NOTHING`,
      [memberId, role]
    );
  }
  // Quiet Room: mira owner, tobin moderator, jules member, nadia banned
  const quietRoles = [
    ['mem_mira_kade', 'owner', false],
    ['mem_tobin_reyes', 'moderator', false],
    ['mem_jules_amari', 'member', false],
    ['mem_nadia_serrano', 'member', true],
  ];
  for (const [memberId, role, banned] of quietRoles) {
    await query(
      `INSERT INTO club_memberships (club_id, member_id, role, banned) VALUES ('club_quiet_room',$1,$2,$3)
       ON CONFLICT (club_id, member_id) DO NOTHING`,
      [memberId, role, banned]
    );
  }

  // Block: nadia_serrano has blocked jules_amari
  await query(
    `INSERT INTO blocks (blocker_id, blocked_id) VALUES ('mem_nadia_serrano','mem_jules_amari')
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`
  );

  // Game 1: finished rated, mira (White) beat wren (Black), Sicilian Defence, checkmate
  {
    const line = ['e2e4', 'c7c5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
    const { rows, finalPos } = playMoves(START_FEN, line, 3 * 24 * 60);
    const st = statusOf(finalPos);
    if (!(st.over && st.reason === 'checkmate' && st.result === '1-0')) {
      throw new Error(`Seed game 1 did not end in White checkmate: ${JSON.stringify(st)}`);
    }
    const gameId = 'game_seeded_mira_wren';
    await query(
      `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, end_reason, opening, created_at, last_move_at)
       VALUES ($1,'mem_mira_kade','mem_wren_oyelaran','club_open_hall',TRUE,NULL,$2,$4,'finished','1-0','checkmate',$3, now() - interval '10 days', now() - interval '10 days')
       ON CONFLICT (id) DO NOTHING`,
      [gameId, rows[rows.length - 1].fen_after, openingFor(line), START_FEN]
    );
    for (const r of rows) {
      await query(
        `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
         VALUES ($1,$2,$3,$4,$5, now() - interval '10 days')
         ON CONFLICT (game_id, ply) DO NOTHING`,
        [gameId, r.ply, r.uci, r.san, r.fen_after]
      );
    }
  }

  // Game 2: rated in progress, mira (White) vs tobin, five moves (pairs) played, White to move, Open Hall
  {
    const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c2c3', 'd7d6'];
    const { rows, finalPos } = playMoves(START_FEN, line, 2 * 60);
    if (finalPos.turn !== 'w') throw new Error('Seed game 2 should leave White to move');
    const gameId = 'game_seeded_mira_tobin';
    await query(
      `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, end_reason, opening, created_at, last_move_at)
       VALUES ($1,'mem_mira_kade','mem_tobin_reyes','club_open_hall',TRUE,NULL,$2,$4,'in_progress','*',NULL,$3, now() - interval '2 days', now() - interval '1 hour')
       ON CONFLICT (id) DO NOTHING`,
      [gameId, rows[rows.length - 1].fen_after, openingFor(line), START_FEN]
    );
    for (const r of rows) {
      await query(
        `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
         VALUES ($1,$2,$3,$4,$5, now() - interval '2 days')
         ON CONFLICT (game_id, ply) DO NOTHING`,
        [gameId, r.ply, r.uci, r.san, r.fen_after]
      );
    }
    // two chat messages in a known order
    await query(
      `INSERT INTO chat_messages (game_id, member_id, text, created_at)
       SELECT $1, 'mem_mira_kade', 'Good luck, tobin. Your Italian is getting sharper.', now() - interval '2 days'
       WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE game_id = $1 AND member_id = 'mem_mira_kade')`,
      [gameId]
    );
    await query(
      `INSERT INTO chat_messages (game_id, member_id, text, created_at)
       SELECT $1, 'mem_tobin_reyes', 'Thanks mira - the quiet room ladder has been good practice.', now() - interval '2 days' + interval '5 minutes'
       WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE game_id = $1 AND member_id = 'mem_tobin_reyes')`,
      [gameId]
    );
  }

  // Game 3: rated in progress inside Quiet Room, tobin (White) vs jules, Slav Defence
  {
    const line = ['d2d4', 'd7d5', 'c2c4', 'c7c6'];
    const { rows } = playMoves(START_FEN, line, 3 * 60);
    const gameId = 'game_seeded_tobin_jules';
    await query(
      `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, end_reason, opening, created_at, last_move_at)
       VALUES ($1,'mem_tobin_reyes','mem_jules_amari','club_quiet_room',TRUE,NULL,$2,$4,'in_progress','*',NULL,$3, now() - interval '3 days', now() - interval '3 hours')
       ON CONFLICT (id) DO NOTHING`,
      [gameId, rows[rows.length - 1].fen_after, openingFor(line), START_FEN]
    );
    for (const r of rows) {
      await query(
        `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
         VALUES ($1,$2,$3,$4,$5, now() - interval '3 days')
         ON CONFLICT (game_id, ply) DO NOTHING`,
        [gameId, r.ply, r.uci, r.san, r.fen_after]
      );
    }
    await query(
      `INSERT INTO chat_messages (game_id, member_id, text, created_at)
       SELECT $1, 'mem_tobin_reyes', 'Slav today? Bold.', now() - interval '3 days'
       WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE game_id = $1 AND member_id = 'mem_tobin_reyes')`,
      [gameId]
    );
    await query(
      `INSERT INTO chat_messages (game_id, member_id, text, created_at)
       SELECT $1, 'mem_jules_amari', 'Practising against the house at steady. It keeps slapping me.', now() - interval '3 days' + interval '2 minutes'
       WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE game_id = $1 AND member_id = 'mem_jules_amari')`,
      [gameId]
    );
  }

  // Game 4: unrated house game of jules at level steady (jules plays White, the house Black)
  {
    const line = ['e2e4'];
    const { rows } = playMoves(START_FEN, line, 90);
    let fen = rows[rows.length - 1].fen_after;
    const houseReply = houseMove(fen, 'steady');
    const pos2 = parseFen(fen);
    const mv2 = legalMoves(pos2).find(m => uci(m) === houseReply);
    const after2 = applyMove(pos2, mv2);
    const gameId = 'game_seeded_jules_house';
    await query(
      `INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, fen_start, status, result, end_reason, opening, created_at, last_move_at)
       VALUES ($1,'mem_jules_amari','mem_the_house',NULL,FALSE,'steady',$2,$3,'in_progress','*',NULL,$4, now() - interval '90 minutes', now() - interval '90 minutes')
       ON CONFLICT (id) DO NOTHING`,
      [gameId, toFen(after2), START_FEN, openingFor(['e2e4', houseReply])]
    );
    await query(
      `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
       VALUES ($1,1,'e2e4',$2,$3, now() - interval '90 minutes')
       ON CONFLICT (game_id, ply) DO NOTHING`,
      [gameId, sanFor(START_FEN, 'e2e4'), rows[0].fen_after]
    );
    await query(
      `INSERT INTO moves (game_id, ply, uci, san, fen_after, created_at)
       VALUES ($1,2,$2,$3,$4, now() - interval '90 minutes')
       ON CONFLICT (game_id, ply) DO NOTHING`,
      [gameId, houseReply, sanFor(fen, houseReply), toFen(after2)]
    );
  }

  // One pending challenge from mira to tobin, rated
  {
    await query(
      `INSERT INTO challenges (id, from_id, to_id, club_id, rated, colour, status, created_at)
       VALUES ('chal_seeded_mira_tobin','mem_mira_kade','mem_tobin_reyes','club_open_hall',TRUE,'White','pending', now() - interval '45 minutes')
       ON CONFLICT (id) DO NOTHING`
    );
    // a notification for the received challenge, unread
    await query(
      `INSERT INTO notifications (member_id, kind, game_id, read, created_at)
       SELECT 'mem_tobin_reyes','challenge',NULL,FALSE, now() - interval '45 minutes'
       WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE member_id='mem_tobin_reyes' AND kind='challenge')`
    );
  }
}

export async function seedHouseMember() {
  // The house opponent: the computer's side in a house game.
  const exists = await query('SELECT id FROM members WHERE id = $1', ['mem_the_house']);
  if (exists.rowCount === 0) {
    await query(
      `INSERT INTO members (id, username, email, password_hash, rating, rated_games, avatar_key, role, view, piece_set_2d, piece_set_3d, theme, sound, created_at)
       VALUES ('mem_the_house','The house','the-house@gambit.hall',$1,1500,0,'avatar_house','member','flat','Classic','Marble','Forest',TRUE, now() - interval '90 days')`,
      [hashPassword(PASSWORD)]
    );
  }
}
