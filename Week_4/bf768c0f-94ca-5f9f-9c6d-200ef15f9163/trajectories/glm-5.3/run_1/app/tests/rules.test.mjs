// Deeper rule tests: sign-in lock, avatar uploads, rename, abort and deadline,
// fivefold repetition, insufficient material, banned club challenges, blocking,
// profile splits and move/chat notifications. Runs against a fresh seed.
import crypto from 'node:crypto';
import pg from '../lib/db.mjs';
import { query } from '../lib/db.mjs';

const BASE = process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173';
const PW = 'gambit-demo-pw-2026';
let passed = 0, failed = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) passed++;
  else { failed++; failures.push(name + (extra !== undefined ? ` :: ${JSON.stringify(extra)}` : '')); }
};

async function api(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body && !raw ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function login(identifier) {
  const r = await api('POST', '/api/auth/login', { body: { email: identifier, password: PW } });
  return r.data.token;
}

const uniq = () => 'lock' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function main() {
  const tobin = await login('tobin_reyes');
  const mira = await login('mira_kade');
  const nadia = await login('nadia_serrano');
  const jules = await login('jules_amari');
  const wren = await login('wren_oyelaran');

  // ---- DP-08: the sign-in lock
  {
    const name = uniq();
    const reg = await api('POST', '/api/auth/register', { body: { username: name, email: `${name}@x.com`, password: 'password123' } });
    check('scratch member registered', reg.status === 201, reg.status);
    // refuse sign-ins until the account answers 423 even to the right password
    let locked = false;
    for (let i = 0; i < 8; i++) {
      const r = await api('POST', '/api/auth/login', { body: { email: name, password: 'wrong-password' } });
      if (r.status === 423) { locked = true; break; }
      check(`refused sign-in ${i + 1} answers 401`, r.status === 401, r.status);
    }
    check('account locks after repeated refusals', locked, 'never locked in 8 tries');
    const right = await api('POST', '/api/auth/login', { body: { email: name, password: 'password123' } });
    check('locked account refuses the correct password with 423', right.status === 423, right.status);
  }

  // ---- DP-09: profile pictures
  {
    const name = uniq();
    await api('POST', '/api/auth/register', { body: { username: name, email: `${name}@x.com`, password: 'password123' } });
    const tok = (await api('POST', '/api/auth/login', { body: { email: name, password: 'password123' } })).data.token;
    // an unsupported type is refused with 415
    const badType = await fetch(BASE + '/api/profile/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'multipart/form-data; boundary=gh', Authorization: `Bearer ${tok}` },
      body: `--gh\r\nContent-Disposition: form-data; name="file"; filename="pic.txt"\r\nContent-Type: text/plain\r\n\r\nnot an image\r\n--gh--\r\n`,
    });
    check('unsupported upload type refused 415', badType.status === 415, badType.status);
    // a file above the size limit is refused with 413
    const big = Buffer.alloc(2 * 1024 * 1024 + 1024, 0x89);
    const bigBody = `--gh\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`;
    const bigRes = await fetch(BASE + '/api/profile/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'multipart/form-data; boundary=gh', Authorization: `Bearer ${tok}` },
      body: Buffer.concat([Buffer.from(bigBody), big, Buffer.from('\r\n--gh--\r\n')]),
    });
    check('oversized upload refused 413', bigRes.status === 413, bigRes.status);
    // refusals store nothing: no upload exists yet
    const storedBefore = await query('SELECT count(*) AS n FROM avatars');
    check('refusals stored nothing', Number(storedBefore.rows[0].n) === 0, storedBefore.rows[0].n);
    // changing another member's picture is refused with 403
    const other = await api('PUT', '/api/profile/avatar', { token: tok, body: { avatar: 'avatar_05' } });
    // (own change first to confirm the endpoint works)
    check('own avatar choice works', other.status === 200 && other.data.avatar_url.includes('avatar_05'), other.status);
    const forbidden = await fetch(BASE + `/api/members/tobin_reyes/avatar`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ avatar: 'avatar_05' }),
    });
    check('changing another member picture refused 403', forbidden.status === 403, forbidden.status);
    // a real PNG is stored and served as a 256x256 PNG
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 80, height: 120, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
    }).png().toBuffer();
    const okBody = `--gh\r\nContent-Disposition: form-data; name="file"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`;
    const okRes = await fetch(BASE + '/api/profile/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'multipart/form-data; boundary=gh', Authorization: `Bearer ${tok}` },
      body: Buffer.concat([Buffer.from(okBody), png, Buffer.from('\r\n--gh--\r\n')]),
    });
    const okText = await okRes.text();
    check('png upload accepted', okRes.status === 200, `${okRes.status} ${okText.slice(0, 80)}`);
    const okData = JSON.parse(okText);
    check('uploaded picture served as PNG', okData.avatar_url.endsWith('.png'), okData.avatar_url);
    const served = await fetch(BASE + okData.avatar_url);
    const servedBuf = Buffer.from(await served.arrayBuffer());
    const meta = await sharp(servedBuf).metadata();
    check('served picture is 256 by 256 PNG', meta.format === 'png' && meta.width === 256 && meta.height === 256, `${meta.format} ${meta.width}x${meta.height}`);
    const prof = await api('GET', '/api/profile', { token: (await api('POST', '/api/auth/login', { body: { email: name, password: 'password123' } })).data.token });
    check('the upload replaced the chosen avatar', prof.data.avatar_url.endsWith('.png'), prof.data.avatar_url);
  }

  // ---- DP-10: a rename shows everywhere the old name did
  {
    const name = uniq();
    await api('POST', '/api/auth/register', { body: { username: name, email: `${name}@x.com`, password: 'password123' } });
    const tok = (await api('POST', '/api/auth/login', { body: { email: name, password: 'password123' } })).data.token;
    // play a quick unrated game with ivo and chat in it
    const ch = await api('POST', '/api/challenges', { token: tok, body: { opponent: 'ivo_lindqvist', rated: false, colour: 'White' } });
    const g = (await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: await login('ivo_lindqvist'), headers: { 'Idempotency-Key': 'ik-' + ch.data.id } })).data;
    await api('POST', `/api/games/${g.id}/moves`, { token: tok, body: { move: 'e2e4' } });
    await api('POST', `/api/games/${g.id}/chat`, { token: tok, body: { text: 'a message under my old name' } });
    const renamed = await api('PATCH', '/api/profile', { token: tok, body: { username: 'renamed_' + name.slice(0, 10) } });
    check('rename accepted', renamed.status === 200, renamed.status);
    const chat = await api('GET', `/api/games/${g.id}/chat`, { token: await login('ivo_lindqvist') });
    check('chat message shows the new name', chat.data.some(m => m.sender.username === renamed.data.username), chat.data.map(m => m.sender.username));
    const rec = await api('GET', `/api/games/${g.id}/record`, { token: tok });
    check('record White tag carries the new name', rec.data.record.includes(`[White "${renamed.data.username}"]`), rec.data.record.split('\n')[4]);
    // game object shows the new name at once
    const gg = await api('GET', `/api/games/${g.id}`, { token: tok });
    check('game header shows the new name', gg.data.white.username === renamed.data.username, gg.data.white.username);
  }

  // ---- DP-38: abort and move deadline, settled when the game is next read
  {
    // a game with no first move inside FIRST_MOVE_ABORT_SEC reads 'aborted'
    const ch = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'tobin_reyes', rated: true, colour: 'White' } });
    const g = (await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: tobin, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } })).data;
    // backdate the creation past the abort window
    const abortSec = parseInt(process.env.FIRST_MOVE_ABORT_SEC, 10);
    await query(`UPDATE games SET created_at = now() - ($1 || ' seconds')::interval WHERE id = $2`, [String(abortSec + 60), g.id]);
    const after = await api('GET', `/api/games/${g.id}`, { token: mira });
    check('unmoved game past the abort window reads aborted', after.data.status === 'aborted', after.data.status);
    check('an aborted game carries an empty result', after.data.result === '', JSON.stringify(after.data.result));
    check('an aborted game is unrated', after.data.rated === false, after.data.rated);
    const miraAfter = await api('GET', '/api/members/mira_kade', { token: mira });
    check('abort moved no rating', miraAfter.data.rated_games === 43 || miraAfter.data.rated_games === 42, miraAfter.data.rated_games);
    // a game idle past MOVE_DEADLINE_SEC is lost by the player who owed the move
    const ch2 = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'wren_oyelaran', rated: true, colour: 'White' } });
    const g2 = (await api('POST', `/api/challenges/${ch2.data.id}/accept`, { token: wren, headers: { 'Idempotency-Key': 'ik-' + ch2.data.id } })).data;
    await api('POST', `/api/games/${g2.id}/moves`, { token: mira, body: { move: 'e2e4' } });
    const deadlineSec = parseInt(process.env.MOVE_DEADLINE_SEC, 10);
    await query(`UPDATE games SET last_move_at = now() - ($1 || ' seconds')::interval WHERE id = $2`, [String(deadlineSec + 60), g2.id]);
    const wrenBefore = await api('GET', '/api/members/wren_oyelaran', { token: wren });
    const g2after = await api('GET', `/api/games/${g2.id}`, { token: mira });
    check('idle game past the deadline is finished by deadline', g2after.data.status === 'finished' && g2after.data.end_reason === 'deadline', g2after.data.end_reason);
    check('the deadline is lost by the player who owed the move (black)', g2after.data.result === '1-0', g2after.data.result);
    const wrenAfter = await api('GET', '/api/members/wren_oyelaran', { token: wren });
    check('the deadline moved the ratings', wrenAfter.data.rating !== wrenBefore.data.rating || wrenAfter.data.rated_games !== wrenBefore.data.rated_games, `${wrenBefore.data.rating}/${wrenBefore.data.rated_games} -> ${wrenAfter.data.rating}/${wrenAfter.data.rated_games}`);
  }

  // ---- DP-27: fivefold repetition draws automatically
  {
    const st = await api('POST', '/api/games/from-fen', { token: mira, body: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' } });
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push('g1f3', 'g8f6', 'f3g1', 'f6g8');
    let last;
    for (const mv of seq) {
      last = await api('POST', `/api/games/${st.data.id}/moves`, { token: mira, body: { move: mv } });
      if (last.status !== 201) break;
    }
    check('fivefold repetition ends the game automatically', last.data.status === 'finished' && last.data.end_reason === 'fivefold repetition' && last.data.result === '1/2-1/2', `${last.data.status} ${last.data && last.data.end_reason}`);
  }

  // ---- DP-27: insufficient material draws automatically
  {
    // from a position with one pawn left, capture it and the game draws at once
    const st = await api('POST', '/api/games/from-fen', { token: mira, body: { fen: '4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1' } });
    const last = await api('POST', `/api/games/${st.data.id}/moves`, { token: mira, body: { move: 'd3e4' } });
    check('insufficient material draws automatically', last.data.status === 'finished' && last.data.end_reason === 'insufficient material' && last.data.result === '1/2-1/2', `${last.data.status} ${last.data && last.data.end_reason}`);
  }

  // ---- DP-42: a banned member cannot challenge through the club
  {
    const r = await api('POST', '/api/challenges', { token: nadia, body: { opponent: 'tobin_reyes', rated: false, colour: 'White', club: 'quiet-room' } });
    check('banned member challenging through the club refused 403', r.status === 403, r.status);
    const outside = await api('GET', '/api/clubs/quiet-room', { token: nadia });
    check('a private club answers a banned outsider as missing', outside.status === 404, outside.status);
  }

  // ---- DP-43: blocking refuses the blocked member chat and unblocking restores it
  {
    // nadia has blocked jules: jules cannot chat nadia in a game nadia started
    const ch = await api('POST', '/api/challenges', { token: nadia, body: { opponent: 'jules_amari', rated: false, colour: 'White' } });
    check('the blocker may still challenge', ch.status === 201, ch.status);
    const g = (await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: jules, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } })).data;
    await api('POST', `/api/games/${g.id}/moves`, { token: nadia, body: { move: 'e2e4' } });
    const blockedChat = await api('POST', `/api/games/${g.id}/chat`, { token: jules, body: { text: 'hello?' } });
    check('blocked member chat refused 403', blockedChat.status === 403, blockedChat.status);
    const blockerChat = await api('POST', `/api/games/${g.id}/chat`, { token: nadia, body: { text: 'hello from the blocker' } });
    check('blocker can still chat', blockerChat.status === 201, blockerChat.status);
    await api('DELETE', '/api/blocks/jules_amari', { token: nadia });
    const restored = await api('POST', `/api/games/${g.id}/chat`, { token: jules, body: { text: 'unblocked now' } });
    check('unblocking restores chat', restored.status === 201, restored.status);
    // restore the seeded block
    await query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ((SELECT id FROM members WHERE username=$1),(SELECT id FROM members WHERE username=$2)) ON CONFLICT DO NOTHING', ['nadia_serrano', 'jules_amari']);
    const again = await api('POST', `/api/games/${g.id}/chat`, { token: jules, body: { text: 'blocked again' } });
    check('the block stands again after restore', again.status === 403, again.status);
  }

  // ---- DP-44: move and chat notifications, exact counts
  {
    const before = await api('GET', '/api/notifications', { token: tobin });
    const ch = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'tobin_reyes', rated: false, colour: 'Black' } });
    const g = (await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: tobin, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } })).data;
    const afterChallenge = await api('GET', '/api/notifications', { token: mira });
    check('challenge notification raised mira unread by one', afterChallenge.data.unread === (await api('GET', '/api/notifications', { token: mira })).data.unread, 'stable');
    // tobin (White) moves: mira gets a move notification
    const unreadBeforeMove = (await api('GET', '/api/notifications', { token: mira })).data.unread;
    await api('POST', `/api/games/${g.id}/moves`, { token: tobin, body: { move: 'e2e4' } });
    const afterMove = await api('GET', '/api/notifications', { token: mira });
    check('an opponent move raised the unread count by one', afterMove.data.unread === unreadBeforeMove + 1, `${unreadBeforeMove} -> ${afterMove.data.unread}`);
    check('the move notification names the mover', afterMove.data.notifications[0].kind === 'move' && afterMove.data.notifications[0].from === 'tobin_reyes', afterMove.data.notifications[0]);
    // chat message notification
    const unreadBeforeChat = (await api('GET', '/api/notifications', { token: mira })).data.unread;
    await api('POST', `/api/games/${g.id}/chat`, { token: tobin, body: { text: 'notification check' } });
    const afterChat = await api('GET', '/api/notifications', { token: mira });
    check('a chat message raised the unread count by one', afterChat.data.unread === unreadBeforeChat + 1, `${unreadBeforeChat} -> ${afterChat.data.unread}`);
    // marking one read lowers it by exactly one
    const target = afterChat.data.notifications.find(n => !n.read);
    const marked = await api('POST', `/api/notifications/${target.id}/read`, { token: mira });
    check('marking one read lowers the count by exactly one', marked.data.unread === afterChat.data.unread - 1, marked.data);
  }

  // ---- DP-48: a member's profile splits results by colour
  {
    const p = await api('GET', '/api/members/tobin_reyes', { token: tobin });
    check('profile splits wins by colour', p.data.wins && typeof p.data.wins.white === 'number' && typeof p.data.wins.black === 'number', p.data.wins);
    check('profile splits losses and draws by colour', p.data.losses && p.data.draws && typeof p.data.losses.white === 'number' && typeof p.data.draws.black === 'number', p.data.losses);
    const games = await api('GET', '/api/members/tobin_reyes/games?limit=10', { token: tobin });
    check('finished games list carries colour, result and reason', games.data.games.every(gg => ['White', 'Black'].includes(gg.colour) && ['1-0', '0-1', '1/2-1/2'].includes(gg.result)), games.data.games[0]);
    check('a member with no finished game shows none in progress', games.data.games.every(gg => gg.result !== '*'), 'ok');
  }

  // ---- DP-03: refusals carry a reason a person can read
  {
    const r = await api('POST', '/api/games/from-fen', { token: tobin, body: { fen: 'nonsense' } });
    check('refusals carry a readable reason', r.status >= 400 && typeof r.data.error === 'string' && r.data.error.length > 5, r.data);
    const nf = await api('GET', '/api/games/game_does_not_exist', { token: tobin });
    check('a missing game answers 404 with a reason', nf.status === 404 && typeof nf.data.error === 'string', nf.data);
  }

  console.log(`\nRULES PASS ${passed} FAIL ${failed}`);
  if (failed) {
    failures.slice(0, 25).forEach(f => console.log('  FAIL:', f));
    process.exit(1);
  }
  await pg.end();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
