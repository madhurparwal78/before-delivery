/**
 * Part two: draws, claims, takebacks, the house, chat, clubs, blocking,
 * notifications, the ladder, voiding and the deadlines.
 */

import { call, login, check, equal, summary, PASSWORD } from './api.mjs';
import { pool } from '../src/db.js';

const unique = Date.now().toString(36);
const newName = (tag) => `v_${tag}_${unique}`.slice(0, 20);

async function register(tag) {
  const username = newName(tag);
  const out = await call('POST', '/api/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  });
  if (out.status !== 201) throw new Error(`register ${username}: ${out.status} ${out.text}`);
  return { username, token: await login(username), id: out.data.id };
}

async function pair(tag, { rated = true, colour = 'White', club } = {}) {
  const white = await register(`${tag}w`);
  const black = await register(`${tag}b`);
  const created = await call('POST', '/api/challenges', {
    token: white.token, body: { opponent: black.username, colour, rated, club },
  });
  const accepted = await call('POST', `/api/challenges/${created.data.id}/accept`, {
    token: black.token, headers: { 'Idempotency-Key': `k-${created.data.id}` },
  });
  return { white, black, game: accepted.data, challenge: created.data };
}

const play = (gameId, token, move) => call('POST', `/api/games/${gameId}/moves`, { token, body: { move } });

// --- DP-28, DP-29 draw offers ----------------------------------------------

{
  const { white, black, game } = await pair('draw');
  const wrongTurn = await call('POST', `/api/games/${game.id}/draw-offer`, { token: black.token });
  check('DP-28 a draw offer off turn is 409', wrongTurn.status === 409, `got ${wrongTurn.status}`);
  const offered = await call('POST', `/api/games/${game.id}/draw-offer`, { token: white.token });
  equal('DP-28 the offer is recorded against its player', offered.data.draw_offer_by, white.username);
  const again = await call('POST', `/api/games/${game.id}/draw-offer`, { token: white.token });
  check('DP-28 a second offer while one is open is 409', again.status === 409, `got ${again.status}`);
  const declined = await call('POST', `/api/games/${game.id}/draw-response`, { token: black.token, body: { accept: false } });
  equal('a declined offer is cleared', declined.data.draw_offer_by, null);
  await call('POST', `/api/games/${game.id}/draw-offer`, { token: white.token });
  await play(game.id, white.token, 'e2e4');
  const afterMove = await call('GET', `/api/games/${game.id}`, { token: white.token });
  equal('DP-28 an offer expires when the opponent moves', afterMove.data.draw_offer_by, null);
  await play(game.id, black.token, 'e7e5');
  await call('POST', `/api/games/${game.id}/draw-offer`, { token: white.token });
  const agreed = await call('POST', `/api/games/${game.id}/draw-response`, { token: black.token, body: { accept: true } });
  equal('DP-29 a game drawn by an accepted offer reads agreement',
    [agreed.data.status, agreed.data.result, agreed.data.end_reason], ['finished', '1/2-1/2', 'agreement']);
  const noOffer = await call('POST', `/api/games/${game.id}/draw-response`, { token: black.token, body: { accept: true } });
  check('answering a finished game is 409', noOffer.status === 409, `got ${noOffer.status}`);
}

// --- DP-27 claims -----------------------------------------------------------

{
  const { white, black, game } = await pair('claim');
  const early = await call('POST', `/api/games/${game.id}/claim`, { token: white.token, body: { kind: 'threefold' } });
  check('DP-27 a threefold claim before its condition is 409', early.status === 409, `got ${early.status}`);
  const earlyFifty = await call('POST', `/api/games/${game.id}/claim`, { token: white.token, body: { kind: 'fifty-move' } });
  check('DP-27 a fifty-move claim before its condition is 409', earlyFifty.status === 409, `got ${earlyFifty.status}`);
  const badKind = await call('POST', `/api/games/${game.id}/claim`, { token: white.token, body: { kind: 'tenfold' } });
  check('an unknown claim kind is 422', badKind.status === 422, `got ${badKind.status}`);

  // Knights out and back twice: the position stands three times.
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < cycle.length; i++) {
      const out = await play(game.id, i % 2 === 0 ? white.token : black.token, cycle[i]);
      if (out.status !== 201) throw new Error(`${cycle[i]} failed ${out.status} ${out.text}`);
    }
  }
  const state = await call('GET', `/api/games/${game.id}`, { token: white.token });
  check('DP-27 the threefold claim is available once the position has stood three times',
    state.data.claims.threefold === true, JSON.stringify(state.data.claims));
  const claimed = await call('POST', `/api/games/${game.id}/claim`, { token: white.token, body: { kind: 'threefold' } });
  equal('DP-27 a valid threefold claim draws', [claimed.data.result, claimed.data.end_reason], ['1/2-1/2', 'threefold claim']);
  const twice = await call('POST', `/api/games/${game.id}/claim`, { token: white.token, body: { kind: 'threefold' } });
  check('a claim arriving twice has one winner', twice.status === 409, `got ${twice.status}`);
}

// --- fivefold and insufficient material, automatically ----------------------

{
  const member = await register('auto');
  const study = await call('POST', '/api/games/from-fen', {
    token: member.token, body: { fen: '4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1' },
  });
  check('a study game is created from a position', study.status === 201, `got ${study.status}`);
  const drawn = await play(study.data.id, member.token, 'd3e4');
  equal('DP-27 insufficient material draws at once',
    [drawn.data.status, drawn.data.result, drawn.data.end_reason], ['finished', '1/2-1/2', 'insufficient material']);

  const repeat = await call('POST', '/api/games/from-fen', {
    token: member.token, body: { fen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1' },
  });
  const cycle = ['a1b1', 'e8d8', 'b1a1', 'd8e8'];
  let last;
  for (let round = 0; round < 4; round++) {
    for (const move of cycle) {
      last = await play(repeat.data.id, member.token, move);
      if (last.status !== 201) break;
    }
  }
  equal('DP-27 fivefold repetition draws with no claim',
    [last.data.status, last.data.end_reason], ['finished', 'fivefold repetition']);

  const bad = await call('POST', '/api/games/from-fen', { token: member.token, body: { fen: 'not a position' } });
  check('a malformed position record is 422', bad.status === 422, `got ${bad.status}`);
}

// --- DP-30 takebacks --------------------------------------------------------

{
  const { white, black, game } = await pair('take');
  const none = await call('POST', `/api/games/${game.id}/takeback-response`, { token: black.token, body: { accept: true } });
  check('DP-30 accepting with none open is 409', none.status === 409, `got ${none.status}`);
  const noMoves = await call('POST', `/api/games/${game.id}/takeback`, { token: white.token });
  check('a takeback before any move is 409', noMoves.status === 409, `got ${noMoves.status}`);
  await play(game.id, white.token, 'e2e4');
  const beforeFen = (await call('GET', `/api/games/${game.id}`, { token: white.token })).data.fen;
  await play(game.id, black.token, 'e7e5');
  const asked = await call('POST', `/api/games/${game.id}/takeback`, { token: black.token });
  equal('DP-30 the request is recorded', asked.data.takeback_by, black.username);
  const second = await call('POST', `/api/games/${game.id}/takeback`, { token: black.token });
  check('a second takeback request is 409', second.status === 409, `got ${second.status}`);
  const accepted = await call('POST', `/api/games/${game.id}/takeback-response`, { token: white.token, body: { accept: true } });
  equal('DP-30 the position is restored', accepted.data.fen, beforeFen);
  equal('DP-30 the move count is restored', accepted.data.moves.length, 1);
  equal('DP-30 the request is cleared', accepted.data.takeback_by, null);
  equal('DP-30 it is the asker\'s turn again', accepted.data.turn, 'black');
}

// --- DP-36 the house --------------------------------------------------------

{
  const member = await register('house');
  const before = (await call('GET', `/api/members/${member.username}`, { token: member.token })).data;
  const created = await call('POST', '/api/computer-games', { token: member.token, body: { level: 'sharp' } });
  check('DP-36 a house game is created and is never rated',
    created.status === 201 && created.data.rated === false && created.data.black.username === 'The house',
    JSON.stringify([created.status, created.data?.rated, created.data?.black?.username]));
  const moved = await play(created.data.id, member.token, 'e2e4');
  equal('DP-36 the house answers inside the same response', moved.data.moves.length, 2);
  check('DP-20 the house move carries its announcement', typeof moved.data.moves[1].announcement === 'string');

  const asBlack = await call('POST', '/api/computer-games', { token: member.token, body: { level: 'sharp', colour: 'black' } });
  equal('DP-36 playing Black, the house has already moved', asBlack.data.moves.length, 1);
  equal('DP-36 the member is Black', asBlack.data.black.username, member.username);

  // Deterministic: the same position at the same level answers the same way.
  const replies = [];
  for (let i = 0; i < 3; i++) {
    const game = await call('POST', '/api/games/from-fen', {
      token: member.token, body: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1', level: 'sharp' },
    });
    const out = await play(game.data.id, member.token, 'e7e5');
    replies.push(out.data.moves.at(-1).uci);
  }
  check('DP-36 the house answers one position identically every time', new Set(replies).size === 1, replies.join(','));

  const mate = await call('POST', '/api/games/from-fen', {
    token: member.token, body: { fen: '6k1/5ppp/8/8/8/7P/8/R5K1 b - - 0 1', level: 'sharp' },
  });
  const mated = await play(mate.data.id, member.token, 'g8h8');
  equal('DP-36 at sharp the house takes a mate in one', mated.data.moves.at(-1).san, 'Ra8#');
  equal('DP-36 the mate ends the game', mated.data.result, '1-0');

  const queen = await call('POST', '/api/games/from-fen', {
    token: member.token, body: { fen: '4k3/8/8/3q4/8/8/8/3QK2R b - - 0 1', level: 'sharp' },
  });
  const taken = await play(queen.data.id, member.token, 'd5d6');
  check('DP-36 at sharp the house takes an undefended queen', taken.data.moves.at(-1).uci === 'd1d6',
    taken.data.moves.at(-1)?.uci);

  const after = (await call('GET', `/api/members/${member.username}`, { token: member.token })).data;
  equal('DP-36 the house moves no rating', [after.rating, after.rated_games], [before.rating, before.rated_games]);
}

// --- DP-39, DP-40, DP-41 chat ----------------------------------------------

{
  const { white, black, game } = await pair('chat');
  const spectator = await register('spec');
  const empty = await call('POST', `/api/games/${game.id}/chat`, { token: white.token, body: { text: '   ' } });
  check('DP-39 an empty message is 422', empty.status === 422, `got ${empty.status}`);
  const long = await call('POST', `/api/games/${game.id}/chat`, { token: white.token, body: { text: 'x'.repeat(501) } });
  check('DP-39 a message over 500 characters is 422', long.status === 422, `got ${long.status}`);
  const ok = await call('POST', `/api/games/${game.id}/chat`, { token: white.token, body: { text: 'x'.repeat(500) } });
  check('DP-39 500 characters is allowed', ok.status === 201, `got ${ok.status}`);
  const script = await call('POST', `/api/games/${game.id}/chat`, {
    token: black.token, body: { text: '<script>alert(1)</script>' },
  });
  equal('DP-39 text is stored verbatim', script.data.text, '<script>alert(1)</script>');
  check('DP-41 a message carries its sender and picture',
    script.data.username === black.username && typeof script.data.avatar_url === 'string');

  const list = await call('GET', `/api/games/${game.id}/chat`, { token: white.token });
  check('DP-39 the chat is a top-level array in send order',
    Array.isArray(list.data) && list.data.length === 2 && list.data[1].text === '<script>alert(1)</script>');

  const limit = Number(process.env.CHAT_RATE_LIMIT);
  let rateLimited = false;
  for (let i = 0; i < limit + 3; i++) {
    const out = await call('POST', `/api/games/${game.id}/chat`, { token: white.token, body: { text: `fast ${i}` } });
    if (out.status === 429) { rateLimited = true; break; }
  }
  check(`DP-39 above ${limit} messages in ten seconds is 429`, rateLimited);

  const readBySpectator = await call('GET', `/api/games/${game.id}/chat`, { token: spectator.token });
  check('DP-40 a spectator reading the chat is 403', readBySpectator.status === 403, `got ${readBySpectator.status}`);
  const postBySpectator = await call('POST', `/api/games/${game.id}/chat`, { token: spectator.token, body: { text: 'hello' } });
  check('DP-40 a spectator posting is 403', postBySpectator.status === 403, `got ${postBySpectator.status}`);
  const moveBySpectator = await play(game.id, spectator.token, 'e2e4');
  check('DP-40 a spectator moving is 403', moveBySpectator.status === 403, `got ${moveBySpectator.status}`);
  const untouched = await call('GET', `/api/games/${game.id}`, { token: spectator.token });
  equal('DP-40 the position is untouched', untouched.data.moves.length, 0);
  check('DP-40 a spectator may still watch', untouched.status === 200);
  for (const path of ['draw-offer', 'resign', 'takeback']) {
    const out = await call('POST', `/api/games/${game.id}/${path}`, { token: spectator.token });
    check(`DP-40 a spectator cannot ${path}`, out.status === 403, `got ${out.status}`);
  }
}

// --- DP-42 private clubs and bans, DP-49 not found -------------------------

{
  const outsider = await register('out');
  const quiet = await call('GET', '/api/clubs/quiet-room', { token: outsider.token });
  check('DP-42 a private club answers an outsider as missing', quiet.status === 404, `got ${quiet.status}`);
  const mira = await login('mira_kade');
  const seen = await call('GET', '/api/clubs/quiet-room', { token: mira });
  check('DP-42 a member of the private club sees it', seen.status === 200 && seen.data.private === true);
  check('DP-42 the roster carries the three roles',
    seen.data.members.some((m) => m.role === 'owner') && seen.data.members.some((m) => m.role === 'moderator')
    && seen.data.members.some((m) => m.role === 'member'));
  check('DP-42 the ban shows on the roster', seen.data.members.some((m) => m.username === 'nadia_serrano' && m.banned));

  const privateGame = await pool.query(
    `select g.id from games g join clubs c on c.id = g.club_id where c.slug = 'quiet-room' limit 1`,
  );
  const gameId = privateGame.rows[0].id;
  const hidden = await call('GET', `/api/games/${gameId}`, { token: outsider.token });
  check('DP-42 a private club\'s game answers an outsider as missing', hidden.status === 404, `got ${hidden.status}`);
  equal('DP-49 the refusal says nothing about the game', hidden.data.error, 'That game is not here.');
  const absent = await call('GET', '/api/games/00000000-0000-0000-0000-000000000000', { token: outsider.token });
  equal('DP-49 a game that does not exist answers the same', absent.data.error, hidden.data.error);
  const visible = await call('GET', `/api/games/${gameId}`, { token: mira });
  check('DP-42 a club member sees the club game', visible.status === 200);

  const nadia = await login('nadia_serrano');
  const banned = await call('POST', '/api/challenges', {
    token: nadia, body: { opponent: 'jules_amari', colour: 'White', rated: true, club: 'quiet-room' },
  });
  check('DP-42 a banned member challenging through the club is 403', banned.status === 403, `got ${banned.status}`);
}

// --- DP-43 blocking ---------------------------------------------------------

{
  const blocker = await register('blk1');
  const blocked = await register('blk2');
  const { game } = await pair('blkgame');
  const made = await call('POST', '/api/blocks', { token: blocker.token, body: { username: blocked.username } });
  check('a block is created', made.status === 201, `got ${made.status}`);
  const challenge = await call('POST', '/api/challenges', {
    token: blocked.token, body: { opponent: blocker.username, colour: 'White', rated: true },
  });
  check('DP-43 a blocked member\'s challenge is 403', challenge.status === 403, `got ${challenge.status}`);

  // Blocking inside an existing game stops the chat as well.
  const pairWhite = await register('blkc1');
  const pairBlack = await register('blkc2');
  const created = await call('POST', '/api/challenges', {
    token: pairWhite.token, body: { opponent: pairBlack.username, colour: 'White', rated: false },
  });
  const accepted = await call('POST', `/api/challenges/${created.data.id}/accept`, {
    token: pairBlack.token, headers: { 'Idempotency-Key': `k2-${created.data.id}` },
  });
  await call('POST', '/api/blocks', { token: pairWhite.token, body: { username: pairBlack.username } });
  const chat = await call('POST', `/api/games/${accepted.data.id}/chat`, { token: pairBlack.token, body: { text: 'hello' } });
  check('DP-43 a blocked member\'s chat is 403', chat.status === 403, `got ${chat.status}`);
  await call('DELETE', `/api/blocks/${pairBlack.username}`, { token: pairWhite.token });
  const afterUnblock = await call('POST', `/api/games/${accepted.data.id}/chat`, { token: pairBlack.token, body: { text: 'hello again' } });
  check('DP-43 unblocking restores the chat', afterUnblock.status === 201, `got ${afterUnblock.status}`);
  const challengeAgain = await call('POST', '/api/challenges', {
    token: blocked.token, body: { opponent: blocker.username, colour: 'White', rated: true },
  });
  await call('DELETE', `/api/blocks/${blocked.username}`, { token: blocker.token });
  const restored = await call('POST', '/api/challenges', {
    token: blocked.token, body: { opponent: blocker.username, colour: 'White', rated: true },
  });
  check('DP-43 unblocking restores the challenge', restored.status === 201, `got ${restored.status}`);
}

// --- DP-44 notifications ----------------------------------------------------

{
  const a = await register('note1');
  const b = await register('note2');
  const start = (await call('GET', '/api/notifications', { token: b.token })).data;
  equal('a new member has nothing unread', start.unread, 0);
  const challenge = await call('POST', '/api/challenges', {
    token: a.token, body: { opponent: b.username, colour: 'White', rated: true },
  });
  const afterChallenge = (await call('GET', '/api/notifications', { token: b.token })).data;
  equal('DP-44 a challenge raises the count by one', afterChallenge.unread, 1);
  check('DP-44 the challenge notification names the challenger', afterChallenge.notifications[0].text.includes(a.username));
  const accepted = await call('POST', `/api/challenges/${challenge.data.id}/accept`, {
    token: b.token, headers: { 'Idempotency-Key': `n-${challenge.data.id}` },
  });
  await play(accepted.data.id, a.token, 'e2e4');
  await call('POST', `/api/games/${accepted.data.id}/chat`, { token: a.token, body: { text: 'your move' } });
  const after = (await call('GET', '/api/notifications', { token: b.token })).data;
  equal('DP-44 a move and a message each raise it by one', after.unread, 3);
  const read = await call('POST', `/api/notifications/${after.notifications[0].id}/read`, { token: b.token });
  equal('DP-44 marking one read lowers it by exactly one', read.data.unread, 2);
  const again = await call('POST', `/api/notifications/${after.notifications[0].id}/read`, { token: b.token });
  equal('DP-44 marking it again never goes below', again.data.unread, 2);
  const foreign = await call('POST', `/api/notifications/${after.notifications[1].id}/read`, { token: a.token });
  check('another member cannot mark my notification read', foreign.status === 403, `got ${foreign.status}`);
}

// --- DP-48 the ladder and the directory ------------------------------------

{
  const member = await login('mira_kade');
  const page = await call('GET', '/api/leaderboard?limit=3', { token: member });
  check('DP-48 the ladder pages at the asked size', page.data.members.length === 3);
  check('DP-48 it orders by rating descending',
    page.data.members[0].rating >= page.data.members[1].rating
    && page.data.members[1].rating >= page.data.members[2].rating);
  check('DP-48 a cursor comes back', typeof page.data.next_cursor === 'string' && page.data.next_cursor.length > 10);
  check('DP-48 the cursor carries no readable offset',
    !/offset|page|rating|\d{3,}/.test(Buffer.from(page.data.next_cursor, 'base64url').toString('latin1')));
  const second = await call('GET', `/api/leaderboard?limit=3&cursor=${encodeURIComponent(page.data.next_cursor)}`, { token: member });
  const firstNames = page.data.members.map((m) => m.username);
  check('DP-48 the next page repeats nobody', second.data.members.every((m) => !firstNames.includes(m.username)));
  const forged = await call('GET', '/api/leaderboard?cursor=not-a-real-cursor', { token: member });
  check('a cursor that was never issued is refused', forged.status >= 400 && forged.status < 500, `got ${forged.status}`);
  const big = await call('GET', '/api/leaderboard?limit=5000', { token: member });
  check('the ladder never returns more than 100', big.data.members.length <= 100);
  const all = await call('GET', '/api/leaderboard', { token: member });
  check('the ladder defaults to 50', all.data.members.length <= 50);

  const directory = await call('GET', '/api/members?q=mira', { token: member });
  check('DP-48 the directory is a top-level array and searches', Array.isArray(directory.data)
    && directory.data.some((m) => m.username === 'mira_kade'));
  const none = await call('GET', '/api/members?q=zzzznobody', { token: member });
  equal('a search with no match is an empty array', none.data, []);
}

// --- DP-34 voiding ----------------------------------------------------------

{
  // Two members play three rated games; the first is then voided.
  const one = await register('void1');
  const two = await register('void2');
  const line = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
  const games = [];
  for (let round = 0; round < 3; round++) {
    const white = round % 2 === 0 ? one : two;
    const black = round % 2 === 0 ? two : one;
    const created = await call('POST', '/api/challenges', {
      token: white.token, body: { opponent: black.username, colour: 'White', rated: true },
    });
    const accepted = await call('POST', `/api/challenges/${created.data.id}/accept`, {
      token: black.token, headers: { 'Idempotency-Key': `v-${created.data.id}` },
    });
    for (let i = 0; i < line.length; i++) {
      const out = await play(accepted.data.id, i % 2 === 0 ? white.token : black.token, line[i]);
      if (out.status !== 201) throw new Error(`void setup move failed ${out.status} ${out.text}`);
    }
    games.push(accepted.data.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const beforeVoid = {
    one: (await call('GET', `/api/members/${one.username}`, { token: one.token })).data,
    two: (await call('GET', `/api/members/${two.username}`, { token: two.token })).data,
  };
  const asMember = await call('POST', `/api/admin/games/${games[0]}/void`, { token: one.token });
  check('DP-34 a member voiding is 403', asMember.status === 403, `got ${asMember.status}`);

  const admin = await login('mira_kade');
  const voided = await call('POST', `/api/admin/games/${games[0]}/void`, { token: admin });
  check('DP-34 the audit is a top-level array of two rows', Array.isArray(voided.data) && voided.data.length === 2,
    JSON.stringify(voided.data).slice(0, 200));
  check('DP-34 the audit names the administrator and both ratings',
    voided.data.every((row) => row.administrator === 'mira_kade'
      && Number.isInteger(row.rating_before) && Number.isInteger(row.rating_after)));
  const voidedGame = await call('GET', `/api/games/${games[0]}`, { token: one.token });
  check('DP-34 the voided game keeps its status and result and reads void',
    voidedGame.data.status === 'finished' && voidedGame.data.result === '1-0'
    && voidedGame.data.rated === false && voidedGame.data.end_reason === 'void',
    JSON.stringify([voidedGame.data.status, voidedGame.data.result, voidedGame.data.rated, voidedGame.data.end_reason]));
  const afterVoid = {
    one: (await call('GET', `/api/members/${one.username}`, { token: one.token })).data,
    two: (await call('GET', `/api/members/${two.username}`, { token: two.token })).data,
  };
  equal('DP-34 each player loses exactly one rated game',
    [afterVoid.one.rated_games, afterVoid.two.rated_games],
    [beforeVoid.one.rated_games - 1, beforeVoid.two.rated_games - 1]);

  // Recompute by hand from the two later games to be sure the order held.
  const { applyResult } = await import('../src/ratings.js');
  let working = { [one.username]: { rating: 1200, rated_games: 0 }, [two.username]: { rating: 1200, rated_games: 0 } };
  for (let round = 1; round < 3; round++) {
    const white = round % 2 === 0 ? one.username : two.username;
    const black = round % 2 === 0 ? two.username : one.username;
    const out = applyResult({ white: working[white], black: working[black], result: '1-0' });
    working = {
      [white]: { rating: out.white.rating_after, rated_games: working[white].rated_games + 1 },
      [black]: { rating: out.black.rating_after, rated_games: working[black].rated_games + 1 },
    };
  }
  equal('DP-34 every later rated game was recomputed in order',
    [afterVoid.one.rating, afterVoid.two.rating],
    [working[one.username].rating, working[two.username].rating]);

  const twice = await call('POST', `/api/admin/games/${games[0]}/void`, { token: admin });
  check('DP-34 voiding a game that is not a finished rated game is 409', twice.status === 409, `got ${twice.status}`);
  const houseGame = await call('POST', '/api/computer-games', { token: one.token, body: { level: 'easy' } });
  const voidHouse = await call('POST', `/api/admin/games/${houseGame.data.id}/void`, { token: admin });
  check('DP-34 voiding a house game is 409', voidHouse.status === 409, `got ${voidHouse.status}`);
}

// --- DP-38 abort and deadline ----------------------------------------------

{
  const { white, black, game } = await pair('dead');
  await pool.query(
    `update games set created_at = now() - make_interval(secs => $2), last_move_at = now() - make_interval(secs => $2) where id = $1`,
    [game.id, Number(process.env.FIRST_MOVE_ABORT_SEC) + 60],
  );
  const aborted = await call('GET', `/api/games/${game.id}`, { token: white.token });
  equal('DP-38 a game with no first move inside the window is aborted',
    [aborted.data.status, aborted.data.result, aborted.data.end_reason, aborted.data.rated],
    ['aborted', '', null, false]);
  const afterAbort = (await call('GET', `/api/members/${white.username}`, { token: white.token })).data;
  equal('DP-38 an abort moves no rating', [afterAbort.rating, afterAbort.rated_games], [1200, 0]);

  const second = await pair('dead2');
  await play(second.game.id, second.white.token, 'e2e4');
  await pool.query(
    `update games set last_move_at = now() - make_interval(secs => $2) where id = $1`,
    [second.game.id, Number(process.env.MOVE_DEADLINE_SEC) + 60],
  );
  const lost = await call('GET', `/api/games/${second.game.id}`, { token: second.white.token });
  equal('DP-38 a game idle past the deadline is lost by the player who owed the move',
    [lost.data.status, lost.data.result, lost.data.end_reason], ['finished', '1-0', 'deadline']);
}

// --- DP-47 openings ---------------------------------------------------------

{
  const member = await register('open');
  const game = await call('POST', '/api/computer-games', { token: member.token, body: { level: 'easy' } });
  const sicilian = await call('POST', '/api/games/import', {
    token: member.token,
    body: {
      record: ['[Event "x"]', '[Site "x"]', '[Date "2026.01.01"]', '[Round "1"]', '[White "a_member"]',
        '[Black "b_member"]', '[Result "*"]', '', '1. d4 d5 2. c4 c6 3. Nc3 Nf6', '*'].join('\n'),
    },
  });
  equal('DP-47 the opening is the longest leading match', sicilian.data.opening, 'Slav Defence');
}

console.log('');
const ok = summary('Part two');
await pool.end();
process.exit(ok ? 0 : 1);
