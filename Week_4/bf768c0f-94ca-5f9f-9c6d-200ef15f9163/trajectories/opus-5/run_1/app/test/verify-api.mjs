/**
 * Checks the pinned API behaviour against the running app.
 * node test/verify-api.mjs
 */

import { call, login, check, equal, summary, PASSWORD } from './api.mjs';
import { applyResult, ratingDisplay } from '../src/ratings.js';

const unique = Date.now().toString(36);
const newName = (tag) => `t_${tag}_${unique}`.slice(0, 20);

async function register(tag) {
  const username = newName(tag);
  const out = await call('POST', '/api/auth/register', {
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  });
  if (out.status !== 201) throw new Error(`register ${username}: ${out.status} ${out.text}`);
  const token = await login(username);
  return { username, token, id: out.data.id };
}

async function challengeAndAccept(from, to, { colour = 'White', rated = true, club } = {}) {
  const created = await call('POST', '/api/challenges', {
    token: from.token,
    body: { opponent: to.username, colour, rated, club },
  });
  if (created.status !== 201) throw new Error(`challenge: ${created.status} ${created.text}`);
  const accepted = await call('POST', `/api/challenges/${created.data.id}/accept`, {
    token: to.token,
    headers: { 'Idempotency-Key': `key-${created.data.id}` },
  });
  if (accepted.status !== 201) throw new Error(`accept: ${accepted.status} ${accepted.text}`);
  return { challenge: created.data, game: accepted.data };
}

async function play(gameId, token, move) {
  return call('POST', `/api/games/${gameId}/moves`, { token, body: { move } });
}

// --- DP-01, DP-02, DP-03 ----------------------------------------------------

{
  const health = await call('GET', '/api/health');
  check('DP-01 health answers 200', health.status === 200);
  check('DP-02 X-Request-Id is returned', /[0-9a-f-]{36}/.test(health.headers.get('x-request-id') || ''));
  const second = await call('GET', '/api/health');
  check('DP-02 request ids differ', health.headers.get('x-request-id') !== second.headers.get('x-request-id'));
}

// --- DP-06 username shape ---------------------------------------------------

{
  for (const bad of ['ab', 'a'.repeat(21), 'has space', 'has-dash', 'dots.here']) {
    const out = await call('POST', '/api/auth/register', {
      body: { username: bad, email: `x${unique}@example.com`, password: PASSWORD },
    });
    check(`DP-06 "${bad}" refused with 422`, out.status === 422, `got ${out.status}`);
  }
  const taken = await call('POST', '/api/auth/register', {
    body: { username: 'MIRA_KADE', email: `other${unique}@example.com`, password: PASSWORD },
  });
  check('DP-06 case-variant of a taken name is 409', taken.status === 409, `got ${taken.status}`);
  check('DP-06 a readable reason comes back', typeof taken.data.error === 'string' && taken.data.error.length > 8);
}

// --- DP-07 sign in and out --------------------------------------------------

{
  const byName = await call('POST', '/api/auth/login', { body: { email: 'mira_kade', password: PASSWORD } });
  const byEmail = await call('POST', '/api/auth/login', { body: { email: 'MIRA_KADE@example.com', password: PASSWORD } });
  check('DP-07 sign in by username', byName.status === 200 && byName.data.member.username === 'mira_kade');
  check('DP-07 sign in by email, case-insensitively', byEmail.status === 200);
  const token = byEmail.data.token;
  check('DP-07 the token reads the profile', (await call('GET', '/api/profile', { token })).status === 200);
  await call('POST', '/api/auth/logout', { token });
  const after = await call('GET', '/api/profile', { token });
  check('DP-07 the old token is dead at once', after.status === 401, `got ${after.status}`);
  const anonymous = await call('GET', '/api/games/anything');
  check('DP-07 no session cannot read a game', anonymous.status === 401, `got ${anonymous.status}`);
  for (const path of ['/api/challenges', '/api/clubs', '/api/members', '/api/notifications']) {
    const out = await call('GET', path);
    check(`DP-07 no session refused on ${path}`, out.status === 401, `got ${out.status}`);
  }
}

// --- DP-08 lock -------------------------------------------------------------

{
  const victim = await register('lock');
  for (let i = 0; i < Number(process.env.LOGIN_MAX_FAILS); i++) {
    await call('POST', '/api/auth/login', { body: { email: victim.username, password: 'wrong-password' } });
  }
  const locked = await call('POST', '/api/auth/login', { body: { email: victim.username, password: PASSWORD } });
  check('DP-08 the right password still answers 423', locked.status === 423, `got ${locked.status}`);
  check('DP-08 the refusal reads', /locked/i.test(locked.data.error || ''));
}

// --- DP-09 picture ----------------------------------------------------------

{
  const member = await register('pic');
  const other = await register('pic2');
  const picked = await call('PUT', '/api/profile/avatar', { token: member.token, body: { avatar: 'avatar_07' } });
  check('DP-09 one of the twelve avatars is taken', picked.status === 200 && picked.data.avatar_url === '/media/avatars/avatar_07.png');
  const bad = await call('PUT', '/api/profile/avatar', { token: member.token, body: { avatar: 'avatar_99' } });
  check('DP-09 an unknown avatar is refused', bad.status === 422, `got ${bad.status}`);
  const foreign = await call('PUT', `/api/members/${member.username}/avatar`, {
    token: other.token, body: { avatar: 'avatar_02' },
  });
  check('DP-09 another member\'s picture is 403', foreign.status === 403, `got ${foreign.status}`);

  // A text file dressed as a picture.
  const boundary = '----gambit';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from('this is not a picture'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const wrongType = await fetch(`http://127.0.0.1:${process.env.APP_PUBLIC_PORT}/api/profile/avatar`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${member.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  check('DP-09 an unsupported upload type is 415', wrongType.status === 415, `got ${wrongType.status}`);

  const huge = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024 + 64)]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const tooBig = await fetch(`http://127.0.0.1:${process.env.APP_PUBLIC_PORT}/api/profile/avatar`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${member.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: huge,
  });
  check('DP-09 an upload above 2 MB is 413', tooBig.status === 413, `got ${tooBig.status}`);
  const profile = await call('GET', '/api/profile', { token: member.token });
  check('DP-09 a refusal stored nothing', profile.data.avatar_url === '/media/avatars/avatar_07.png');
}

// --- DP-11 preferences ------------------------------------------------------

{
  const member = await register('pref');
  const fresh = await call('GET', '/api/profile', { token: member.token });
  equal('DP-11 a new member starts flat, Classic, Marble, Forest, sound on', [
    fresh.data.view, fresh.data.piece_set_2d, fresh.data.piece_set_3d, fresh.data.theme, fresh.data.sound,
  ], ['flat', 'Classic', 'Marble', 'Forest', true]);
  const set = await call('PATCH', '/api/profile', {
    token: member.token,
    body: { view: 'deep', piece_set_2d: 'Pixel', piece_set_3d: 'Glass', theme: 'Neon', sound: false },
  });
  equal('DP-11 every preference is stored', [
    set.data.view, set.data.piece_set_2d, set.data.piece_set_3d, set.data.theme, set.data.sound,
  ], ['deep', 'Pixel', 'Glass', 'Neon', false]);
  // A second browser is a second session.
  const secondToken = await login(member.username);
  const again = await call('GET', '/api/profile', { token: secondToken });
  equal('DP-11 the choices survive signing in elsewhere', [again.data.piece_set_2d, again.data.theme], ['Pixel', 'Neon']);
  for (const body of [{ piece_set_2d: 'Fancy' }, { theme: 'Teal' }, { view: 'isometric' }, { piece_set_3d: 'Steel' }, { sound: 'yes' }]) {
    const out = await call('PATCH', '/api/profile', { token: member.token, body });
    check(`DP-11 ${JSON.stringify(body)} refused with 422`, out.status === 422, `got ${out.status}`);
  }
  const other = await register('pref2');
  const foreign = await call('PATCH', `/api/members/${member.username}/profile`, {
    token: other.token, body: { theme: 'Slate' },
  });
  check('DP-11 another member\'s preferences are 403', foreign.status === 403, `got ${foreign.status}`);
  const mine = await call('PATCH', `/api/members/${member.username}/profile`, {
    token: member.token, body: { theme: 'Slate' },
  });
  check('DP-11 a member may change their own', mine.status === 200);
}

// --- DP-17, DP-23, DP-24, DP-25 ---------------------------------------------

{
  const white = await register('w1');
  const black = await register('b1');
  const { game } = await challengeAndAccept(white, black);
  check('DP-17 the first response carries 64 named squares', Array.isArray(game.squares) && game.squares.length === 64);
  check('DP-17 a square carries its occupant', game.squares.find((s) => s.name === 'e2').pieceName === 'White Pawn');
  equal('DP-45 the colour the form sent is the colour the game carries', game.white.username, white.username);
  check('game object shape', game.turn === 'white' && game.status === 'in_progress' && game.result === '*'
    && game.end_reason === null && game.rated === true && game.draw_offer_by === null && game.takeback_by === null
    && game.claims.threefold === false && game.claims['fifty-move'] === false && game.game_id === game.id);

  const legal = await call('GET', `/api/games/${game.id}/legal-moves`, { token: white.token });
  check('DP-03 legal moves are a top-level array', Array.isArray(legal.data));
  equal('DP-23 the starting position has 20 legal moves', legal.data.length, 20);

  const illegal = await play(game.id, white.token, 'e2e5');
  check('DP-23 an illegal move is 422', illegal.status === 422, `got ${illegal.status}`);
  const outOfTurn = await play(game.id, black.token, 'e7e5');
  check('DP-31 a move out of turn is 409', outOfTurn.status === 409, `got ${outOfTurn.status}`);

  const first = await play(game.id, white.token, 'e2e4');
  check('a move answers 201', first.status === 201, `got ${first.status}`);
  equal('DP-25 the move list records the move played', first.data.moves.map((m) => m.uci), ['e2e4']);
  equal('DP-20 the announcement is in the pinned form', first.data.moves[0].announcement, 'Pawn to e4');
  equal('DP-25 the game fen equals its highest-ply move', first.data.fen, first.data.moves[0].fen_after);
  equal('DP-24 a double push with no capture available leaves the field empty', first.data.fen.split(' ')[3], '-');

  await play(game.id, black.token, 'd7d5');
  const ep = await play(game.id, white.token, 'e4e5');
  equal('DP-24 the halfmove clock resets on a pawn move', ep.data.fen.split(' ')[4], '0');
  const epSetter = await play(game.id, black.token, 'f7f5');
  equal('DP-24 the en passant field names the square when the capture is there', epSetter.data.fen.split(' ')[3], 'f6');
  const captured = await play(game.id, white.token, 'e5f6');
  equal('DP-23 en passant plays', captured.data.moves.at(-1).san, 'exf6');
  equal('DP-20 a capture is announced in the pinned form', captured.data.moves.at(-1).announcement, 'Pawn takes f6');
  const fullmove = Number(captured.data.fen.split(' ')[5]);
  equal('DP-24 the fullmove number rose after each Black move', fullmove, 3);
}

// --- DP-35 single winner ----------------------------------------------------

{
  const white = await register('race1');
  const black = await register('race2');
  const { game, challenge } = await challengeAndAccept(white, black);
  const [a, b] = await Promise.all([
    play(game.id, white.token, 'e2e4'),
    play(game.id, white.token, 'd2d4'),
  ]);
  const codes = [a.status, b.status].sort();
  equal('DP-35 two moves for one ply leave one 201 and one 409', codes, [201, 409]);
  const after = await call('GET', `/api/games/${game.id}`, { token: white.token });
  equal('DP-35 exactly one move is stored', after.data.moves.length, 1);

  const replay = await call('POST', `/api/challenges/${challenge.id}/accept`, {
    token: black.token, headers: { 'Idempotency-Key': `key-${challenge.id}` },
  });
  check('DP-35 a replayed accept returns the same game', replay.status === 201 && replay.data.id === game.id,
    `${replay.status} ${replay.data?.id} vs ${game.id}`);
  const withoutKey = await call('POST', `/api/challenges/${challenge.id}/accept`, { token: black.token });
  check('a second accept without the key is refused', withoutKey.status === 409, `got ${withoutKey.status}`);
}

// --- DP-33 ratings, DP-21 result, DP-47 record ------------------------------

const MATE_LINE = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

{
  const white = await register('rate1');
  const black = await register('rate2');
  const before = {
    white: (await call('GET', `/api/members/${white.username}`, { token: white.token })).data,
    black: (await call('GET', `/api/members/${black.username}`, { token: black.token })).data,
  };
  const { game } = await challengeAndAccept(white, black);
  let last;
  for (let i = 0; i < MATE_LINE.length; i++) {
    const token = i % 2 === 0 ? white.token : black.token;
    last = await play(game.id, token, MATE_LINE[i]);
    if (last.status !== 201) throw new Error(`move ${MATE_LINE[i]} failed: ${last.status} ${last.text}`);
  }
  equal('a game ends in checkmate', [last.data.status, last.data.result, last.data.end_reason], ['finished', '1-0', 'checkmate']);
  equal('DP-20 mate is announced with its ending', last.data.moves.at(-1).announcement, 'Queen takes f7, checkmate');
  equal('claims are false once the game is over', [last.data.claims.threefold, last.data.claims['fifty-move']], [false, false]);

  const expected = applyResult({
    white: { rating: before.white.rating, rated_games: before.white.rated_games },
    black: { rating: before.black.rating, rated_games: before.black.rated_games },
    result: '1-0',
  });
  const after = {
    white: (await call('GET', `/api/members/${white.username}`, { token: white.token })).data,
    black: (await call('GET', `/api/members/${black.username}`, { token: black.token })).data,
  };
  equal('DP-33 the winner moves by the published step', after.white.rating, expected.white.rating_after);
  equal('DP-33 the loser moves by the published step', after.black.rating, expected.black.rating_after);
  equal('DP-33 both counts rose by one', [after.white.rated_games, after.black.rated_games],
    [before.white.rated_games + 1, before.black.rated_games + 1]);
  equal('DP-33 a provisional rating carries its question mark', after.white.rating_display,
    ratingDisplay(after.white.rating, after.white.rated_games));
  check('DP-33 under ten rated games shows the mark', after.white.rating_display.endsWith('?'));

  const record = await call('GET', `/api/games/${game.id}/record`, { token: white.token, raw: true });
  const tags = record.text.split('\n').filter((line) => line.startsWith('['));
  equal('DP-47 the seven tags come in order', tags.map((line) => line.slice(1, line.indexOf(' '))),
    ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result']);
  check('DP-47 the date is YYYY.MM.DD', /\[Date "\d{4}\.\d{2}\.\d{2}"\]/.test(record.text));
  check('DP-47 the result tag carries 1-0', record.text.includes('[Result "1-0"]'));
  check('DP-47 mate carries its hash', record.text.includes('Qxf7#'));
  check('DP-10 the record names both players', record.text.includes(white.username) && record.text.includes(black.username));

  const imported = await call('POST', '/api/games/import', { token: white.token, body: { record: record.text } });
  equal('DP-47 an imported record reaches the same position', imported.data.fen, last.data.fen);
  equal('DP-47 the import replays every move', imported.data.moves.length, MATE_LINE.length);

  const broken = record.text.replace('Qxf7#', 'Qxb8');
  const refused = await call('POST', '/api/games/import', { token: white.token, body: { record: broken } });
  check('DP-47 a bad record is 422 naming its line', refused.status === 422 && /line \d+/.test(refused.data.error),
    `${refused.status} ${refused.data?.error}`);

  // DP-37 rematch
  const rematch = await call('POST', `/api/games/${game.id}/rematch`, { token: white.token });
  check('DP-37 a rematch swaps the colours and keeps the rated flag',
    rematch.status === 201 && rematch.data.white.username === black.username
    && rematch.data.black.username === white.username && rematch.data.rated === true,
    JSON.stringify([rematch.status, rematch.data?.white?.username, rematch.data?.rated]));

  const finishedMove = await play(game.id, white.token, 'a2a3');
  check('DP-31 a move into a finished game is 409', finishedMove.status === 409, `got ${finishedMove.status}`);

  // DP-48 profile by colour
  const profile = await call('GET', `/api/members/${white.username}`, { token: white.token });
  equal('DP-48 wins are split by colour', [profile.data.wins.white, profile.data.losses.black], [1, 0]);
  const loserProfile = await call('GET', `/api/members/${black.username}`, { token: black.token });
  equal('DP-48 the loser shows a black loss', [loserProfile.data.losses.black, loserProfile.data.wins.white], [1, 0]);
  const games = await call('GET', `/api/members/${white.username}/games`, { token: white.token });
  check('DP-48 the finished game is listed with its record link',
    games.data.games.length === 1 && games.data.games[0].result === '1-0'
    && games.data.games[0].reason === 'checkmate' && games.data.games[0].colour === 'White'
    && games.data.games[0].game_id === game.id && 'next_cursor' in games.data);
}

console.log('');
process.exit(summary('Part one') ? 0 : 1);
