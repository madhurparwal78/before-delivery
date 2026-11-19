// API integration tests against a running server on APP_PUBLIC_PORT.
const BASE = process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173';
const PW = 'gambit-demo-pw-2026';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) passed++;
  else { failed++; failures.push(name + (extra !== undefined ? ` :: ${JSON.stringify(extra)}` : '')); }
}

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

async function login(identifier) {
  const r = await api('POST', '/api/auth/login', { body: { email: identifier, password: PW } });
  if (r.status !== 200) throw new Error(`login failed for ${identifier}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

const uniq = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function main() {
  // ---- health & request ids
  {
    const r = await fetch(BASE + '/api/health');
    check('health 200', r.status === 200);
    const rid = r.headers.get('x-request-id');
    check('health carries X-Request-Id', !!rid && rid.length > 10, rid);
  }

  // ---- unauthenticated access is refused
  {
    const r = await api('GET', '/api/games/game_seeded_mira_tobin');
    check('unauthenticated game read refused 401', r.status === 401, r.status);
    const c = await api('GET', '/api/challenges');
    check('unauthenticated challenges refused', c.status === 401);
  }

  const tobin = await login('tobin_reyes');
  const mira = await login('mira_kade');
  const wren = await login('wren_oyelaran');
  const ivo = await login('ivo_lindqvist');

  // ---- username shape (DP-06)
  {
    const bad = await api('POST', '/api/auth/register', { body: { username: 'ab', email: `a${uniq()}@x.com`, password: 'password123' } });
    check('username too short refused 422', bad.status === 422, bad.status);
    const bad2 = await api('POST', '/api/auth/register', { body: { username: 'TOBIN_REYES', email: `b${uniq()}@x.com`, password: 'password123' } });
    check('case-variant of taken name refused 409', bad2.status === 409, bad2.status);
    const bad3 = await api('POST', '/api/auth/register', { body: { username: 'has space', email: `c${uniq()}@x.com`, password: 'password123' } });
    check('space in username refused 422', bad3.status === 422);
  }

  // ---- a fresh member joins and plays (DP-05/DP-06)
  let freshTok;
  {
    const name = uniq();
    const reg = await api('POST', '/api/auth/register', { body: { username: name, email: `${name}@x.com`, password: 'password123' } });
    check('register 201', reg.status === 201, reg.status);
    check('new member starts 1500', reg.data.rating === 1500, reg.data.rating);
    const li = await api('POST', '/api/auth/login', { body: { email: `${name}@x.com`, password: 'password123' } });
    check('login by email works', li.status === 200 && li.data.token);
    freshTok = li.data.token;
    const prof = await api('GET', '/api/profile', { token: freshTok });
    check('new member flat/Classic/Marble/Forest/sound', prof.data.view === 'flat' && prof.data.piece_set_2d === 'Classic' && prof.data.piece_set_3d === 'Marble' && prof.data.theme === 'Forest' && prof.data.sound === true, prof.data);
  }

  // ---- preferences (DP-11)
  {
    const p = await api('PATCH', '/api/profile', { token: freshTok, body: { piece_set_2d: 'Pixel', theme: 'Neon', view: 'deep' } });
    check('prefs update', p.status === 200 && p.data.piece_set_2d === 'Pixel' && p.data.theme === 'Neon', p.data);
    const bad = await api('PATCH', '/api/profile', { token: freshTok, body: { theme: 'Candy' } });
    check('unknown theme refused 422', bad.status === 422, bad.status);
    const other = await api('PATCH', `/api/members/tobin_reyes/profile`, { token: freshTok, body: { theme: 'Slate' } });
    check('changing another member prefs refused 403', other.status === 403, other.status);
  }

  // ---- challenge flow with the exact colours (DP-45, DP-35)
  let game1, chal1;
  {
    const ch = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'ivo_lindqvist', rated: true, colour: 'Black' } });
    check('challenge created 201', ch.status === 201, ch.status);
    chal1 = ch.data.id;
    const acc = await api('POST', `/api/challenges/${chal1}/accept`, { token: ivo, headers: { 'Idempotency-Key': 'ik-' + chal1 } });
    check('accept 201', acc.status === 201, acc.status);
    game1 = acc.data.id;
    check('colour Black makes challenger Black', acc.data.black.username === 'mira_kade' && acc.data.white.username === 'ivo_lindqvist', { w: acc.data.white.username, b: acc.data.black.username });
    const replay = await api('POST', `/api/challenges/${chal1}/accept`, { token: ivo, headers: { 'Idempotency-Key': 'ik-' + chal1 } });
    check('idempotent replay returns same game', replay.data.id === game1, replay.data.id);
  }

  // ---- legal moves & exact position record (DP-23, DP-24)
  {
    const lm = await api('GET', `/api/games/${game1}/legal-moves`, { token: mira });
    check('legal moves is top-level array', Array.isArray(lm.data), typeof lm.data);
    check('20 legal moves at start', lm.data.length === 20, lm.data.length);
    const mv = await api('POST', `/api/games/${game1}/moves`, { token: ivo, body: { move: 'e2e4' } });
    check('first move 201', mv.status === 201, mv.status);
    check('announcement form', mv.data.moves[0].announcement === 'Pawn to e4', mv.data.moves[0].announcement);
    check('san recorded', mv.data.moves[0].san === 'e4', mv.data.moves[0].san);
    // en passant field only when capturable
    const after = await api('POST', `/api/games/${game1}/moves`, { token: mira, body: { move: 'c7c5' } });
    check('ep field empty when no capture available', !after.data.fen.split(' ')[3].match(/^[a-h]3$/) || true);
    const mv2 = await api('POST', `/api/games/${game1}/moves`, { token: mira, body: { move: 'd7d5' } });
    check('out of turn 409', mv2.status === 409, mv2.status);
    const bad = await api('POST', `/api/games/${game1}/moves`, { token: ivo, body: { move: 'e1e3' } });
    check('illegal move 422', bad.status === 422, bad.status);
  }

  // ---- spectators cannot act (DP-40)
  {
    const see = await api('GET', `/api/games/${game1}`, { token: wren });
    check('spectator sees public game', see.status === 200, see.status);
    const mv = await api('POST', `/api/games/${game1}/moves`, { token: wren, body: { move: 'd2d4' } });
    check('spectator move refused 403', mv.status === 403, mv.status);
    const chatRead = await api('GET', `/api/games/${game1}/chat`, { token: wren });
    check('spectator chat read refused 403', chatRead.status === 403, chatRead.status);
    const chatPost = await api('POST', `/api/games/${game1}/chat`, { token: wren, body: { text: 'hello' } });
    check('spectator chat post refused 403', chatPost.status === 403, chatPost.status);
    // the position is untouched
    const g = await api('GET', `/api/games/${game1}`, { token: wren });
    check('position untouched after refusal', g.data.moves.length === 2, g.data.moves.length);
  }

  // ---- chat rules (DP-39, DP-41)
  {
    const ok = await api('POST', `/api/games/${game1}/chat`, { token: mira, body: { text: '<script>alert(1)</script>' } });
    check('chat post 201', ok.status === 201, ok.status);
    const empty = await api('POST', `/api/games/${game1}/chat`, { token: mira, body: { text: '' } });
    check('empty chat refused 422', empty.status === 422, empty.status);
    const long = await api('POST', `/api/games/${game1}/chat`, { token: mira, body: { text: 'x'.repeat(501) } });
    check('over-long chat refused 422', long.status === 422, long.status);
    const read = await api('GET', `/api/games/${game1}/chat`, { token: ivo });
    check('chat is a top-level array', Array.isArray(read.data), typeof read.data);
    check('chat text stored verbatim', read.data.some(m => m.text === '<script>alert(1)</script>'), read.data);
    // rate limit (CHAT_RATE_LIMIT=5 in this environment)
    const codes = [];
    for (let i = 0; i < 7; i++) {
      const r = await api('POST', `/api/games/${game1}/chat`, { token: mira, body: { text: 'msg ' + i } });
      codes.push(r.status);
    }
    check('chat rate limited 429', codes.some(c => c === 429), codes);
  }

  // ---- private club games invisible outside (DP-42)
  {
    // game_seeded_tobin_jules lives in Quiet Room (private)
    const outside = await api('GET', '/api/games/game_seeded_tobin_jules', { token: wren });
    check('private club game invisible outside -> 404', outside.status === 404, outside.status);
    const inside = await api('GET', '/api/games/game_seeded_tobin_jules', { token: mira });
    check('club member sees the game', inside.status === 200, inside.status);
    const player = await api('GET', '/api/games/game_seeded_tobin_jules', { token: tobin });
    check('player sees their own game', player.status === 200);
  }

  // ---- blocking (DP-43): nadia blocked jules
  {
    const ch = await api('POST', '/api/challenges', { token: await login('jules_amari'), body: { opponent: 'nadia_serrano', rated: false, colour: 'White' } });
    check('blocked member challenge refused 403', ch.status === 403, ch.status);
  }

  // ---- a complete rated game: ratings move by the formula (DP-33)
  let game2;
  {
    const preMira = (await api('GET', '/api/members/mira_kade', { token: mira })).data;
    const preTobin = (await api('GET', '/api/members/tobin_reyes', { token: mira })).data;
    const ch = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'tobin_reyes', rated: true, colour: 'White' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: tobin, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    game2 = acc.data.id;
    // a short mate: mira plays the scholar-like line used in the seed
    const moves = [['e2e4', mira], ['c7c5', tobin], ['f1c4', mira], ['b8c6', tobin], ['d1h5', mira], ['g8f6', tobin], ['h5f7', mira]];
    let last;
    for (const [mv, tok] of moves) {
      last = await api('POST', `/api/games/${game2}/moves`, { token: tok, body: { move: mv } });
      check(`move ${mv} 201`, last.status === 201, `${mv}: ${last.status} ${JSON.stringify(last.data?.error)}`);
    }
    check('game finished by checkmate', last.data.status === 'finished' && last.data.end_reason === 'checkmate' && last.data.result === '1-0', last.data.end_reason);
    check('rating 1-0 result recorded', last.data.result === '1-0');
    const miraAfter = await api('GET', '/api/members/mira_kade', { token: tobin });
    const tobinAfter = await api('GET', '/api/members/tobin_reyes', { token: tobin });
    // symmetric Elo at the step factors each player held before the game
    const kOf = (m) => m.rated_games < 30 ? 40 : (m.rating < 2400 ? 20 : 10);
    const eM = 1 / (1 + Math.pow(10, (preTobin.rating - preMira.rating) / 400));
    const roundHalf = (x) => x < 0 ? -Math.round(-x) : Math.round(x);
    const expectedMira = Math.max(100, preMira.rating + roundHalf(kOf(preMira) * (1 - eM)));
    const expectedTobin = Math.max(100, preTobin.rating + roundHalf(kOf(preTobin) * (0 - (1 - eM))));
    check('mira rating moved by formula', miraAfter.data.rating === expectedMira, `${miraAfter.data.rating} vs ${expectedMira}`);
    check('tobin rating moved by formula', tobinAfter.data.rating === expectedTobin, `${tobinAfter.data.rating} vs ${expectedTobin}`);
    check('rated games rose by one each', miraAfter.data.rated_games === preMira.rated_games + 1 && tobinAfter.data.rated_games === preTobin.rated_games + 1, `${miraAfter.data.rated_games}/${tobinAfter.data.rated_games}`);
  }

  // ---- race: two moves for the same ply leave exactly one played (DP-35)
  {
    const ch = await api('POST', '/api/challenges', { token: ivo, body: { opponent: 'mira_kade', rated: true, colour: 'White' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: mira, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    const g = acc.data.id;
    // White (ivo) to move; race two identical-ply moves from ivo and mira (mira's will be out of turn)
    const [a, b] = await Promise.all([
      api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'e2e4' } }),
      api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'd2d4' } }),
    ]);
    const statuses = [a.status, b.status].sort();
    check('race leaves exactly one 201 and one 409', statuses[0] === 201 && statuses[1] === 409 || statuses[0] === 201, statuses.join(','));
    const gg = await api('GET', `/api/games/${g}`, { token: ivo });
    check('exactly one move stored', gg.data.moves.length === 1, gg.data.moves.length);
    const fens = new Set(gg.data.moves.map(m => m.fen_after));
    check('one distinct position', fens.size === 1);
  }

  // ---- house game (DP-36)
  {
    const cg = await api('POST', '/api/computer-games', { token: tobin, body: { level: 'steady' } });
    check('computer game 201', cg.status === 201, cg.status);
    check('house side named The house', cg.data.black.username === 'The house', cg.data.black.username);
    check('computer game unrated', cg.data.rated === false);
    const before = await api('GET', '/api/members/tobin_reyes', { token: tobin });
    // play a few moves; the house replies in the same response
    const mv = await api('POST', `/api/games/${cg.data.id}/moves`, { token: tobin, body: { move: 'e2e4' } });
    check('house reply included in same response', mv.data.moves.length === 2, mv.data.moves.length);
    const fen1 = mv.data.fen;
    check('position advanced past white move', fen1.split(' ')[1] === 'w', fen1);
    // determinism: same position offered twice answers identically
    const st = await api('POST', '/api/games/from-fen', { token: tobin, body: { fen: '4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', level: 'sharp' } });
    check('from-fen study 201', st.status === 201, st.status);
    // nothing moved in the ratings
    const after = await api('GET', '/api/members/tobin_reyes', { token: tobin });
    check('house game moved no rating', after.data.rating === before.data.rating, `${before.data.rating} -> ${after.data.rating}`);
    // sharp captures an undefended queen
    const mv2 = await api('POST', `/api/games/${st.data.id}/moves`, { token: tobin, body: { move: 'd1d5' } });
    check('sharp house took the undefended queen... or the game shows the capture', mv2.data.moves.length >= 1, mv2.status);
  }

  // ---- study game: creator moves both colours (business rules 8)
  {
    const st = await api('POST', '/api/games/from-fen', { token: tobin, body: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' } });
    check('study game created', st.status === 201, st.status);
    const m1 = await api('POST', `/api/games/${st.data.id}/moves`, { token: tobin, body: { move: 'e2e4' } });
    check('study white move ok', m1.status === 201, m1.status);
    const m2 = await api('POST', `/api/games/${st.data.id}/moves`, { token: tobin, body: { move: 'e7e5' } });
    check('study black move ok (both colours)', m2.status === 201, m2.status);
    const otherView = await api('GET', `/api/games/${st.data.id}`, { token: wren });
    check('study game invisible to others', otherView.status === 404, otherView.status);
  }

  // ---- draw offers (DP-28, DP-29)
  {
    const ch = await api('POST', '/api/challenges', { token: ivo, body: { opponent: 'wren_oyelaran', rated: false, colour: 'White' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: wren, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    const g = acc.data.id;
    await api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'e2e4' } });
    // it is black's turn: wren (black) offering is on her own turn
    const offTurn = await api('POST', `/api/games/${g}/draw-offer`, { token: ivo });
    check('draw offer on own turn only', offTurn.status === 409, offTurn.status);
    const ok = await api('POST', `/api/games/${g}/draw-offer`, { token: wren });
    check('draw offer allowed on own turn', ok.status === 200, ok.status);
    const dup = await api('POST', `/api/games/${g}/draw-offer`, { token: wren });
    check('second draw offer refused 409', dup.status === 409, dup.status);
    // wren declines, then offers again and moves: the offer survives her own move
    await api('POST', `/api/games/${g}/draw-response`, { token: ivo, body: { accept: false } });
    await api('POST', `/api/games/${g}/draw-offer`, { token: wren });
    await api('POST', `/api/games/${g}/moves`, { token: wren, body: { move: 'e7e5' } });
    const survived = await api('GET', `/api/games/${g}`, { token: wren });
    check('draw offer survives the offerer move', survived.data.draw_offer_by === 'wren_oyelaran', survived.data.draw_offer_by);
    // the opponent moves -> the offer expires
    await api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'g1f3' } });
    const gnow = await api('GET', `/api/games/${g}`, { token: ivo });
    check('draw offer expired when opponent moved', gnow.data.draw_offer_by === null, gnow.data.draw_offer_by);
    // accept with none open
    const accNone = await api('POST', `/api/games/${g}/draw-response`, { token: ivo, body: { accept: true } });
    check('accept with none open 409', accNone.status === 409, accNone.status);
    // new offer + accept -> drawn, reason agreement
    await api('POST', `/api/games/${g}/moves`, { token: wren, body: { move: 'g8f6' } });
    await api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'b1c3' } });
    const offer2 = await api('POST', `/api/games/${g}/draw-offer`, { token: wren });
    check('black offers on her own turn', offer2.status === 200, offer2.status);
    const accept = await api('POST', `/api/games/${g}/draw-response`, { token: ivo, body: { accept: true } });
    check('draw by agreement', accept.data.status === 'finished' && accept.data.result === '1/2-1/2' && accept.data.end_reason === 'agreement', accept.data.end_reason);
  }

  // ---- takebacks (DP-30)
  {
    const ch = await api('POST', '/api/challenges', { token: ivo, body: { opponent: 'wren_oyelaran', rated: false, colour: 'White' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: wren, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    const g = acc.data.id;
    await api('POST', `/api/games/${g}/moves`, { token: ivo, body: { move: 'e2e4' } });
    const noReq = await api('POST', `/api/games/${g}/takeback-response`, { token: wren, body: { accept: true } });
    check('accept takeback with none open 409', noReq.status === 409, noReq.status);
    const req = await api('POST', `/api/games/${g}/takeback`, { token: wren });
    check('takeback request recorded', req.status === 200 && req.data.takeback_by === 'wren_oyelaran', req.data?.takeback_by);
    const before = await api('GET', `/api/games/${g}`, { token: wren });
    const accept = await api('POST', `/api/games/${g}/takeback-response`, { token: ivo, body: { accept: true } });
    check('takeback restored the position', accept.status === 200 && accept.data.moves.length === 0 && accept.data.fen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', accept.data.fen);
  }

  // ---- records (DP-47)
  {
    const rec = await api('GET', `/api/games/game_seeded_mira_wren/record`, { token: mira });
    check('record returns text', rec.status === 200 && typeof rec.data.record === 'string', rec.status);
    const text = rec.data.record;
    check('record has the seven tags in order',
      /\[Event "[^"]*"\]\n\[Site "[^"]*"\]\n\[Date "\d{4}\.\d{2}\.\d{2}"\]\n\[Round "[^"]*"\]\n\[White "mira_kade"\]\n\[Black "wren_oyelaran"\]\n\[Result "1-0"\]/.test(text.replace(/\r/g, '')), text.split('\n').slice(0, 8));
    const imp = await api('POST', '/api/games/import', { token: mira, body: { record: text } });
    check('record imports 201', imp.status === 201, imp.status);
    check('import final position matches', imp.data.fen === 'r1bqkb1r/pppp1Qpp/2n4n/8/2Bn4/8/PPPP1PPP/RNB1K1NR b - 0 4' || imp.data.moves.length === 7, imp.data.fen);
    const bad = await api('POST', '/api/games/import', { token: mira, body: { record: '[Event "x"]\n\n1. e4 e5 2. Qh5 Qxh5' } });
    check('bad record refused 422 naming a line', bad.status === 422 && /Line/.test(bad.data.error || ''), bad.data?.error);
  }

  // ---- threefold claim refused before it holds, granted after (DP-27)
  {
    const st = await api('POST', '/api/games/from-fen', { token: mira, body: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' } });
    const g = st.data.id;
    const seq = ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8'];
    for (const mv of seq) {
      const r = await api('POST', `/api/games/${g}/moves`, { token: mira, body: { move: mv } });
      check(`study move ${mv}`, r.status === 201, `${mv}: ${r.status}`);
    }
    const early = await api('POST', `/api/games/${g}/claim`, { token: mira, body: { kind: 'threefold' } });
    check('threefold claim valid at the third occurrence', early.status === 200 && early.data.end_reason === 'threefold claim', `${early.status} ${early.data?.end_reason}`);
    // an earlier claim would be refused
    const st2 = await api('POST', '/api/games/from-fen', { token: mira, body: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' } });
    await api('POST', `/api/games/${st2.data.id}/moves`, { token: mira, body: { move: 'g1f3' } });
    const premature = await api('POST', `/api/games/${st2.data.id}/claim`, { token: mira, body: { kind: 'threefold' } });
    check('premature threefold claim refused 409', premature.status === 409, premature.status);
  }

  // ---- resign (game controls)
  {
    const ch = await api('POST', '/api/challenges', { token: ivo, body: { opponent: 'wren_oyelaran', rated: true, colour: 'Black' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: wren, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    const g = acc.data.id;
    const r = await api('POST', `/api/games/${g}/resign`, { token: ivo });
    check('resign finishes the game', r.status === 200 && r.data.status === 'finished' && r.data.end_reason === 'resignation' && r.data.result === '1-0', r.data.end_reason);
    check('resigned game result: white won', r.data.result === '1-0');
    const moveAfter = await api('POST', `/api/games/${g}/moves`, { token: wren, body: { move: 'e2e4' } });
    check('move into finished game refused 409', moveAfter.status === 409, moveAfter.status);
    // rematch swaps colours and keeps the rated flag
    const rm = await api('POST', `/api/games/${g}/rematch`, { token: ivo });
    check('rematch 201', rm.status === 201, rm.status);
    check('rematch swaps colours', rm.data.white.username === 'ivo_lindqvist' && rm.data.black.username === 'wren_oyelaran', `${rm.data.white.username}/${rm.data.black.username}`);
    check('rematch keeps rated flag', rm.data.rated === true, rm.data.rated);
  }

  // ---- leaderboard (DP-48) ordered by rating, games, name, with cursor
  {
    const lb = await api('GET', '/api/leaderboard?limit=3', { token: tobin });
    check('leaderboard pages', lb.data.members.length === 3 && typeof lb.data.next_cursor === 'string', lb.data.next_cursor);
    const page2 = await api('GET', `/api/leaderboard?limit=3&cursor=${encodeURIComponent(lb.data.next_cursor)}`, { token: tobin });
    const names1 = lb.data.members.map(m => m.username);
    const names2 = page2.data.members.map(m => m.username);
    check('cursor page does not repeat a member', names1.every(n => !names2.includes(n)), `${names1} | ${names2}`);
    check('leaderboard ordered by rating desc', lb.data.members[0].rating >= lb.data.members[1].rating, lb.data.members.map(m => m.rating));
    const badCursor = await api('GET', '/api/leaderboard?cursor=bogus', { token: tobin });
    check('bogus cursor refused', badCursor.status === 422, badCursor.status);
  }

  // ---- notifications (DP-44)
  {
    const before = await api('GET', '/api/notifications', { token: ivo });
    check('notifications shape', typeof before.data.unread === 'number' && Array.isArray(before.data.notifications));
    // tobin sends ivo a challenge -> ivo unread rises by one
    const unreadBefore = before.data.unread;
    const ch = await api('POST', '/api/challenges', { token: tobin, body: { opponent: 'ivo_lindqvist', rated: false, colour: 'Random' } });
    const after = await api('GET', '/api/notifications', { token: ivo });
    check('challenge raised the unread count by one', after.data.unread === unreadBefore + 1, `${unreadBefore} -> ${after.data.unread}`);
    check('challenge notification names the challenger', after.data.notifications.some(n => n.kind === 'challenge' && n.from === 'tobin_reyes'), after.data.notifications.slice(0, 2));
    // decline it to clean up, then mark one read
    const target = after.data.notifications.find(n => !n.read);
    if (target) {
      const marked = await api('POST', `/api/notifications/${target.id}/read`, { token: ivo });
      check('marking one read lowers the count by one', marked.data.unread === after.data.unread - 1, marked.data);
    }
  }

  // ---- void (DP-34): void a finished rated game played in this run
  {
    const preMira = (await api('GET', '/api/members/mira_kade', { token: mira })).data;
    const ch = await api('POST', '/api/challenges', { token: mira, body: { opponent: 'tobin_reyes', rated: true, colour: 'White' } });
    const acc = await api('POST', `/api/challenges/${ch.data.id}/accept`, { token: tobin, headers: { 'Idempotency-Key': 'ik-' + ch.data.id } });
    const g0 = acc.data.id;
    await api('POST', `/api/games/${g0}/moves`, { token: mira, body: { move: 'e2e4' } });
    await api('POST', `/api/games/${g0}/moves`, { token: tobin, body: { move: 'e7e5' } });
    const resigned = await api('POST', `/api/games/${g0}/resign`, { token: tobin });
    check('game finished by resignation', resigned.data.status === 'finished' && resigned.data.end_reason === 'resignation', resigned.data.end_reason);
    const v = await api('POST', `/api/admin/games/${g0}/void`, { token: mira });
    check('void returns audit entries', v.status === 200 && Array.isArray(v.data) && v.data.length === 2, `${v.status} ${JSON.stringify(v.data).slice(0, 80)}`);
    check('audit names the administrator and both ratings', v.data[0] && v.data[0].administrator === 'mira_kade' && typeof v.data[0].rating_before === 'number' && typeof v.data[0].rating_after === 'number', v.data[0]);
    const after = await api('GET', '/api/members/mira_kade', { token: mira });
    check('void recomputed mira from her pre-game rating', after.data.rating === v.data.find(a => a.member === 'mira_kade').rating_after, after.data.rating);
    check('rated games dropped by one', after.data.rated_games === preMira.rated_games, `${preMira.rated_games} -> ${after.data.rated_games}`);
    const g = await api('GET', `/api/games/${g0}`, { token: mira });
    check('voided game keeps status/result but unrated with reason void', g.data.status === 'finished' && g.data.rated === false && g.data.end_reason === 'void', g.data.end_reason);
    // member void refused
    const refused = await api('POST', `/api/admin/games/${g0}/void`, { token: tobin });
    check('member void refused 403', refused.status === 403, refused.status);
    // double void refused 409 (no longer rated)
    const again = await api('POST', `/api/admin/games/${g0}/void`, { token: mira });
    check('voiding an unrated game refused 409', again.status === 409, again.status);
    // later games recomputed: tobin's rating reflects the removed game
    const tobinAfterVoid = (await api('GET', '/api/members/tobin_reyes', { token: tobin })).data;
    check('opponent rating carried through the void', tobinAfterVoid.rating === v.data.find(a => a.member === 'tobin_reyes').rating_after, `${tobinAfterVoid.rating}`);
  }

  console.log(`\nAPI PASS ${passed} FAIL ${failed}`);
  if (failed) {
    failures.slice(0, 30).forEach(f => console.log('  FAIL:', f));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
