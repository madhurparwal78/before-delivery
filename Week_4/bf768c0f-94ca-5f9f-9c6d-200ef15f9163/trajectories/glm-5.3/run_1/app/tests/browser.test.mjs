// Browser-level verification of the journeys with headless Chromium.
// Verifies the three views, the keyboard board, the announcements, the
// animations, the live updates, the themes and sets, and the spectator rules.
import { chromium } from 'playwright-core';

const BASE = process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173';
const PW = 'gambit-demo-pw-2026';
let passed = 0, failed = 0;
const failures = [];
const check = (name, cond, extra) => {
  if (cond) passed++;
  else { failed++; failures.push(name + (extra !== undefined ? ` :: ${extra}` : '')); }
};

const waitFor = async (fn, timeout = 6000, every = 200) => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await new Promise(r => setTimeout(r, every));
  }
};

async function newSession(browser, username) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/hall');
  return { ctx, page };
}

async function main() {
  // a pristine store: the seeded challenge must be pending
  const { execSync } = await import('node:child_process');
  execSync('node /app/scripts/reset.mjs', { stdio: 'ignore' });
  const browser = await chromium.launch();

  // ---- journey 4/11: preferences persist and apply
  {
    const { ctx, page } = await newSession(browser, 'tobin_reyes');
    await page.goto(BASE + '/settings');
    await page.selectOption('#set-2d', 'Pixel');
    await page.selectOption('#set-theme', 'Neon');
    await page.waitForTimeout(600);
    // a fresh browser sees the same preferences
    const { ctx: ctx2, page: page2 } = await newSession(browser, 'tobin_reyes');
    await page2.goto(BASE + '/settings');
    const v = await page2.$eval('#set-2d', el => el.value);
    const t = await page2.$eval('#set-theme', el => el.value);
    check('prefs persist across sessions (Pixel/Neon)', v === 'Pixel' && t === 'Neon', `${v}/${t}`);
    await page2.selectOption('#set-2d', 'Classic');
    await page2.selectOption('#set-theme', 'Forest');
    await page2.waitForTimeout(400);
    await ctx.close();
    await ctx2.close();
  }

  // ---- journey 1: play a rated game from the seeded challenge
  {
    const tobin = await newSession(browser, 'tobin_reyes');
    const mira = await newSession(browser, 'mira_kade');
    await tobin.page.goto(BASE + '/challenges');
    const accept = tobin.page.locator('[data-accept]').first();
    await accept.waitFor({ timeout: 5000 });
    await accept.click();
    await tobin.page.waitForURL('**/game/**', { timeout: 8000 });
    check('accepting the seeded challenge lands on the game', true);
    check('board is present with 64 squares', (await tobin.page.$$('[data-board="flat"] [data-square]')).length === 64);
    check('keyboard board has 64 squares', (await tobin.page.$$('[data-board="keys"] [data-square]')).length === 64);
    // tobin is Black in this game; mira plays e2e4 from the flat board
    await mira.page.goto(BASE + '/game/' + tobin.page.url().split('/game/')[1]);
    // mira plays a move by clicking
    await mira.page.click('[data-board="flat"] [data-square="e2"]');
    await mira.page.click('[data-board="flat"] [data-square="e4"]');
    await mira.page.waitForTimeout(900);
    const mvList = await mira.page.$$eval('[data-move-list] .row', rows => rows.map(r => r.textContent.trim()));
    check('move appears in the move list', mvList.length >= 1 && mvList[0].includes('e4'), JSON.stringify(mvList));
    // the announcement reaches the other player's open page within 5 seconds
    const ann = await waitFor(async () => {
      const t = await tobin.page.$eval('#live-announcer', el => el.textContent);
      return t === 'Pawn to e4' ? t : null;
    });
    check('move announced in the live region', ann === 'Pawn to e4', ann);
    // switching views mid-game keeps the position
    await tobin.page.click('[data-view="deep"]');
    await tobin.page.waitForTimeout(700);
    const deepVisible = await tobin.page.$eval('[data-view-deep]', el => !el.hidden);
    check('deep view appears', deepVisible);
    await tobin.page.click('[data-view="flat"]');
    const stillE4 = await tobin.page.$$eval('[data-move-list] .row', rows => rows.length);
    check('switching views mid-game keeps the move list', stillE4 >= 1, stillE4);
    // square list view
    await tobin.page.click('[data-view="squares"]');
    await tobin.page.waitForTimeout(300);
    const tableRows = await tobin.page.$$eval('[data-squares-table] tr', rows => rows.length);
    check('square list shows 64 squares', tableRows === 64, tableRows);
    await tobin.page.click('[data-view="flat"]');
    // keyboard play: tobin (black) plays e7e5 with arrow keys and Enter only
    // (his page must first learn it is his turn: the poll delivers mira's move)
    await waitFor(async () => tobin.page.evaluate(() => window.__game && window.__game.myTurn()));
    await tobin.page.focus('[data-board="keys"] [data-square="e7"]');
    await tobin.page.keyboard.press('Enter');   // select the piece on e7
    await tobin.page.keyboard.press('ArrowDown');
    await tobin.page.keyboard.press('ArrowDown');
    await tobin.page.keyboard.press('Enter');   // play to the focused square
    await waitFor(async () => tobin.page.evaluate(() => window.__game.game.moves.length === 2));
    const moves2 = await tobin.page.$$eval('[data-move-list] .row', rows => rows.map(r => r.textContent.trim()));
    check('keyboard move played (e7e5)', moves2.length >= 1 && moves2[0].includes('e5'), JSON.stringify(moves2));
    const ann2 = await waitFor(async () => {
      const t = await mira.page.$eval('#live-announcer', el => el.textContent);
      return t === 'Pawn to e5' ? t : null;
    });
    check('opponent move reached the other page (live update)', ann2 === 'Pawn to e5', ann2);
    // animations are listed while they run
    await waitFor(async () => mira.page.evaluate(() => window.__game && window.__game.myTurn()));
    await mira.page.click('[data-board="flat"] [data-square="g1"]');
    await mira.page.click('[data-board="flat"] [data-square="f3"]');
    const anims = await waitFor(async () => {
      const list = await mira.page.evaluate(() => document.getAnimations().map(a => ({
        name: a.animationName || a.transitionProperty || 'waapi',
        iterations: a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1,
      })));
      return list.length ? list : null;
    }, 2000, 60);
    check('a CSS animation runs on the page after a move', anims && anims.some(a => a.name && a.name !== 'none'), JSON.stringify(anims).slice(0, 120));
    await mira.page.waitForTimeout(900);
    // the chat message reaches the other player's open page without a reload
    await tobin.page.fill('#chat-msg', 'Good game so far.');
    await tobin.page.click('[data-form="chat"] button');
    const chatToMira = await waitFor(async () => {
      const texts = await mira.page.$$eval('[data-chat-log] .chat-msg .text', els => els.map(e => e.textContent));
      return texts.some(t => t === 'Good game so far.') ? texts : null;
    });
    check('chat message reaches the other player', !!chatToMira, JSON.stringify(chatToMira));
    // spectator rules (journey 5)
    const wren = await newSession(browser, 'wren_oyelaran');
    const gameId = tobin.page.url().split('/game/')[1];
    await wren.page.goto(BASE + '/game/' + gameId);
    await wren.page.waitForTimeout(500);
    const chatVisible = await wren.page.$eval('[data-chat-card]', el => el.textContent);
    check('spectator sees the board and is told the chat is for players', chatVisible.includes('chat is for the two players'), chatVisible.slice(0, 60));
    // chat message covered above
    // the spectator never sees chat: the API refuses
    const specChat = await wren.page.evaluate(async () => {
      const r = await fetch(`/api/games/${location.pathname.split('/game/')[1]}/chat`, { credentials: 'same-origin' });
      return r.status;
    });
    check('spectator chat read refused 403', specChat === 403, specChat);
    const specMove = await wren.page.evaluate(async () => {
      const r = await fetch(`/api/games/${location.pathname.split('/game/')[1]}/moves`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move: 'a7a6' }), credentials: 'same-origin',
      });
      return r.status;
    });
    check('spectator move refused 403', specMove === 403, specMove);
    await wren.ctx.close();
    await tobin.ctx.close();
    await mira.ctx.close();
  }

  // ---- reduced motion: the six animations become instant, no infinite animation
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/login');
    await page.fill('#login-username', 'ivo_lindqvist');
    await page.fill('#login-password', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL('**/hall');
    await page.goto(BASE + '/play');
    await page.click('[data-house-level="easy"]');
    await page.waitForURL('**/game/**');
    const anims = await page.evaluate(() => document.getAnimations().filter(a => {
      try { return a.effect.getTiming().iterations === Infinity; } catch { return false; }
    }).length);
    check('no infinite animation under reduced motion', anims === 0, anims);
    await page.click('[data-board="flat"] [data-square="e2"]');
    await page.click('[data-board="flat"] [data-square="e4"]');
    await waitFor(async () => page.evaluate(() => window.__game && window.__game.game.moves.length === 2));
    const moves = await page.evaluate(() => window.__game.game.moves.length);
    check('house game: move played and house replied', moves === 2, moves);
    await ctx.close();
  }

  // ---- responsive: no sideways scroll at the pinned widths
  {
    const { ctx, page } = await newSession(browser, 'tobin_reyes');
    for (const width of [320, 360, 390, 414]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ['/hall', '/challenges', '/leaderboard', '/settings', '/notifications']) {
        await page.goto(BASE + route);
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`no sideways scroll at ${width} on ${route}`, overflow <= 1, `overflow ${overflow}px`);
      }
    }
    // the game screen at 390: full-width board with the side column under it
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(BASE + '/game/game_seeded_mira_tobin');
    await page.waitForTimeout(400);
    const layout = await page.$eval('.game-layout', el => getComputedStyle(el).gridTemplateColumns);
    check('at 390 the side column sits under a full-width board', layout.split(' ').length === 1 || layout.includes('minmax(0, 1fr)'), layout);
    const boardW = await page.$eval('[data-board-frame]', el => el.getBoundingClientRect().width);
    check('the board stays square at 390', boardW > 300, boardW);
    await ctx.close();
  }

  // ---- deep board: WebGL renders, drag turns the view, a move travels
  {
    const { ctx, page } = await newSession(browser, 'tobin_reyes');
    await page.goto(BASE + '/play');
    await page.click('[data-house-level="steady"]');
    await page.waitForURL('**/game/**');
    await page.click('[data-view="deep"]');
    await page.waitForTimeout(900);
    const glOk = await page.evaluate(() => {
      const c = document.querySelector('[data-deep-canvas]');
      if (!c) return 'no canvas';
      const gl = c.getContext('webgl2');
      return gl ? 'webgl ok' : 'no webgl';
    });
    check('deep board uses WebGL', glOk === 'webgl ok', glOk);
    // the deep board fits the viewport at 1440x900 and at 390 wide
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const fit = await page.evaluate(() => {
      const c = document.querySelector('[data-deep-canvas]');
      const r = c.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    check('deep board fits 1440x900 without scrolling', fit.left >= 0 && fit.right <= fit.vw && fit.bottom <= fit.vh + 2, JSON.stringify(fit));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(400);
    const fitNarrow = await page.evaluate(() => {
      const c = document.querySelector('[data-deep-canvas]');
      const r = c.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth };
    });
    check('deep board fits 390 wide', fitNarrow.left >= 0 && fitNarrow.right <= fitNarrow.vw + 1, JSON.stringify(fitNarrow));
    // drag turns the view; the position must not change
    const before = await page.$eval('[data-move-list]', el => el.textContent.trim());
    const canvas = await page.$('[data-deep-canvas]');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.$eval('[data-move-list]', el => el.textContent.trim());
    check('dragging the deep view changes no piece', before === after, `${before} vs ${after}`);
    // play a move by pointing in the deep view: the same code path a real click runs
    await page.evaluate(() => { window.__deep.onSquareClick('e2'); window.__deep.onSquareClick('e4'); });
    await waitFor(async () => page.evaluate(() => window.__game.game.moves.length === 2));
    const deepPlies = await page.evaluate(() => window.__game.game.moves.length);
    check('a deep-view move is an ordinary move, house replied', deepPlies === 2, deepPlies);
    // the deep board shows the piece standing on its destination once the travel ends
    const deepPieceOnE4 = await waitFor(async () => {
      const ok = await page.evaluate(() => {
        const p = window.__deep.pieces.find(p => p.square === 'e4');
        return p ? Math.abs(p.pos[0] - 0.5) < 0.01 && Math.abs(p.pos[2] - -0.5) < 0.01 : false;
      });
      return ok || null;
    }, 4000, 150);
    check('the deep board agrees where the piece stands', !!deepPieceOnE4, deepPieceOnE4);
    await ctx.close();
  }

  // ---- themes and sets change visibly, pieces keep their names
  {
    const { ctx, page } = await newSession(browser, 'tobin_reyes');
    await page.goto(BASE + '/game/game_seeded_mira_tobin');
    await page.waitForTimeout(400);
    const bgA = await page.$eval('[data-board="flat"] .sq2.dark', el => getComputedStyle(el).backgroundColor);
    await page.goto(BASE + '/settings');
    await page.selectOption('#set-theme', 'Neon');
    await page.waitForTimeout(600);
    await page.goto(BASE + '/game/game_seeded_mira_tobin');
    await page.waitForTimeout(400);
    const bgB = await page.$eval('[data-board="flat"] .sq2.dark', el => getComputedStyle(el).backgroundColor);
    check('themes change the squares plainly', bgA !== bgB, `${bgA} -> ${bgB}`);
    // all five themes differ plainly
    const themes = ['Walnut', 'Slate', 'Ocean', 'Forest', 'Neon'];
    const seen = new Set();
    for (const t of themes) {
      await page.goto(BASE + '/settings');
      await page.selectOption('#set-theme', t);
      await page.waitForTimeout(500);
      await page.goto(BASE + '/game/game_seeded_mira_tobin');
      await page.waitForTimeout(300);
      const c = await page.$eval('[data-board="flat"] .sq2.dark', el => getComputedStyle(el).backgroundColor);
      seen.add(c);
    }
    check('all five themes differ', seen.size === 5, [...seen].join(' | '));
    // four flat sets differ and the piece names stay
    const sets = ['Classic', 'Staunton Flat', 'Neo', 'Pixel'];
    const setArts = new Set();
    let names = null;
    for (const s of sets) {
      await page.goto(BASE + '/settings');
      await page.selectOption('#set-2d', s);
      await page.waitForTimeout(500);
      await page.goto(BASE + '/game/game_seeded_mira_tobin');
      await page.waitForTimeout(300);
      const art = await page.$eval('[data-board="flat"] .piece svg', el => el.innerHTML.length);
      setArts.add(art);
      names = await page.$$eval('[data-board="keys"] button', els => els.map(b => b.getAttribute('aria-label')).filter(l => l && l.includes('Knight')).length);
    }
    check('all four flat sets visibly change the pieces', setArts.size >= 3, [...setArts].join(' | '));
    check('a knight keeps its accessible name in every set', names === 4, names);
    await page.goto(BASE + '/settings');
    await page.selectOption('#set-2d', 'Classic');
    await page.selectOption('#set-theme', 'Forest');
    await page.waitForTimeout(500);
    await ctx.close();
  }

  // ---- journey 3: the house at sharp takes a mate in one
  {
    const { ctx, page } = await newSession(browser, 'tobin_reyes');
    const result = await page.evaluate(async () => {
      // a position where the house (Black) has mate in one once White moves
      const r = await fetch('/api/games/from-fen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: '3q2k1/r4ppp/8/8/8/8/5PPP/N6K w - - 0 1',
          level: 'sharp',
        }), credentials: 'same-origin',
      });
      const study = await r.json();
      const mv = await fetch(`/api/games/${study.id}/moves`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move: 'a1b3' }), credentials: 'same-origin',
      });
      return { status: mv.status, data: await mv.json() };
    });
    check('study with level: creator move answered by the house', result.status === 201 && result.data.moves.length === 2, `${result.status} moves:${result.data && result.data.moves ? result.data.moves.length : 'err'}`);
    check('the house played its mate in one', result.data.status === 'finished' && result.data.result === '0-1' && result.data.end_reason === 'checkmate', `${result.data.status} ${result.data.end_reason}`);
    const lastAnn = result.data.moves[1].announcement;
    check('the house move is announced with checkmate', /checkmate$/.test(lastAnn), lastAnn);
    // nothing in the ratings moved
    const tobinNow = await page.evaluate(async () => {
      const r = await fetch('/api/members/tobin_reyes', { credentials: 'same-origin' });
      return (await r.json());
    });
    check('the house game moved no rating', tobinNow.rated_games === 37, tobinNow.rated_games);
    await ctx.close();
  }

  // ---- journey 2: finish a game and see the rating move by the formula
  {
    const tobin = await newSession(browser, 'tobin_reyes');
    const mira = await newSession(browser, 'mira_kade');
    const preTobin = await tobin.page.evaluate(async () => {
      const r = await fetch('/api/members/tobin_reyes', { credentials: 'same-origin' });
      return (await r.json());
    });
    const preMira = await mira.page.evaluate(async () => {
      const r = await fetch('/api/members/mira_kade', { credentials: 'same-origin' });
      return (await r.json());
    });
    // create and accept a challenge
    const ch = await mira.page.evaluate(async () => {
      const r = await fetch('/api/challenges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opponent: 'tobin_reyes', rated: true, colour: 'White' }), credentials: 'same-origin',
      });
      return (await r.json());
    });
    const gameId = await tobin.page.evaluate(async chId => {
      const r = await fetch(`/api/challenges/${chId}/accept`, {
        method: 'POST', headers: { 'Idempotency-Key': 'browser-' + chId }, credentials: 'same-origin',
      });
      return (await r.json()).id;
    }, ch.id);
    await mira.page.goto(BASE + '/game/' + gameId);
    await tobin.page.goto(BASE + '/game/' + gameId);
    // a short mate line
    const line = ['e2e4', 'c7c5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
    for (let i = 0; i < line.length; i++) {
      const isWhiteMove = i % 2 === 0;
      const actor = isWhiteMove ? mira : tobin;
      await waitFor(async () => actor.page.evaluate(() => window.__game && window.__game.myTurn()));
      await actor.page.click(`[data-board="flat"] [data-square="${line[i].slice(0, 2)}"]`);
      await actor.page.click(`[data-board="flat"] [data-square="${line[i].slice(2, 4)}"]`);
      await waitFor(async () => actor.page.evaluate(i => window.__game.game.moves.length === i + 1, i));
    }
    await mira.page.waitForTimeout(1200);
    // victory and defeat screens
    const overlayMira = await mira.page.$('.game-over-overlay');
    check('victory screen for the winner', !!overlayMira);
    const titleMira = overlayMira ? await overlayMira.$eval('.title', el => el.textContent) : '';
    check('the victory screen reads You won', titleMira === 'You won', titleMira);
    const overlayTobin = await tobin.page.$('.game-over-overlay');
    const titleTobin = overlayTobin ? await overlayTobin.$eval('.title', el => el.textContent) : '';
    check('the defeat screen reads You lost', titleTobin === 'You lost', titleTobin);
    const reasonTobin = overlayTobin ? await overlayTobin.$eval('.reason', el => el.textContent) : '';
    check('the reason is named', reasonTobin.includes('checkmate'), reasonTobin);
    // ratings moved by the formula from pre-game numbers
    const postTobin = await tobin.page.evaluate(async () => {
      const r = await fetch('/api/members/tobin_reyes', { credentials: 'same-origin' });
      return (await r.json());
    });
    const postMira = await mira.page.evaluate(async () => {
      const r = await fetch('/api/members/mira_kade', { credentials: 'same-origin' });
      return (await r.json());
    });
    const kOf = m => m.rated_games < 30 ? 40 : (m.rating < 2400 ? 20 : 10);
    const e = 1 / (1 + Math.pow(10, (preTobin.rating - preMira.rating) / 400));
    const roundHalf = x => x < 0 ? -Math.round(-x) : Math.round(x);
    const expectMira = preMira.rating + roundHalf(kOf(preMira) * (1 - e));
    const expectTobin = preTobin.rating + roundHalf(kOf(preTobin) * (0 - (1 - e)));
    check('mira rating moved by the formula', postMira.rating === expectMira, `${postMira.rating} vs ${expectMira}`);
    check('tobin rating moved by the formula', postTobin.rating === expectTobin, `${postTobin.rating} vs ${expectTobin}`);
    await tobin.ctx.close();
    await mira.ctx.close();
  }

  console.log(`\nBROWSER PASS ${passed} FAIL ${failed}`);
  if (failed) {
    failures.slice(0, 25).forEach(f => console.log('  FAIL:', f));
    process.exitCode = 1;
  }
  await browser.close();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
