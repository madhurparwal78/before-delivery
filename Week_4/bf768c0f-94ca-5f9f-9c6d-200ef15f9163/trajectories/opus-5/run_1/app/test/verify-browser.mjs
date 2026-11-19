/**
 * Browser checks: the three views, the animations, the keyboard, the themes,
 * the sets, the layout and the live updates.
 * NODE_PATH=/opt/verify/node_modules node test/verify-browser.mjs
 */

import { createRequire } from 'node:module';

// Playwright is a local checking tool kept outside the app's own dependencies.
const require = createRequire('/opt/verify/');
const { chromium } = require('playwright');
const sharp = (await import('sharp')).default;

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT}`;
const PASSWORD = 'gambit-demo-pw-2026';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected),
  `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

/** Poll a predicate in the page: waitForFunction needs eval, which the app's
 * own content security policy rightly refuses. */
async function waitFor(page, fn, arg = null, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    // eslint-disable-next-line no-await-in-loop
    if (await page.evaluate(fn, arg)) return true;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
  }
  return false;
}

async function signIn(context, username) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/hall|\/game|\/challenges/, { timeout: 15000 });
  return page;
}

// --- public pages, own origin, labels --------------------------------------

{
  const context = await browser.newContext();
  const page = await context.newPage();
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(BASE) && !request.url().startsWith('data:')) external.push(request.url());
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE}/`);
  check('DP-04 the welcome loads nothing from another origin', external.length === 0, external.join(', '));
  check('the welcome opens on a board', await page.locator('.board-grid .square').count() === 64);
  check('DP-15 the welcome carries a skip link', await page.locator('.skip-link').first().textContent() === 'Skip to content');
  await page.goto(`${BASE}/login`);
  check('the sign-in form carries its pinned labels',
    await page.getByLabel('Username').count() === 1 && await page.getByLabel('Password').count() === 1
    && await page.getByRole('button', { name: 'Sign in' }).count() === 1);
  await page.goto(`${BASE}/join`);
  check('the join form carries Email and its button',
    await page.getByLabel('Email').count() === 1
    && await page.getByRole('button', { name: 'Join the hall' }).count() === 1);
  await page.goto(`${BASE}/hall`);
  check('DP-07 a visitor on a member route lands on sign in', page.url().includes('/login?next=%2Fhall'), page.url());
  await page.goto(`${BASE}/no-such-address`);
  check('DP-49 an unknown address shows the same page',
    (await page.locator('h1').first().textContent()) === 'That game is not here.');
  check('no page errors on the public pages', errors.length === 0, errors.join(' | '));
  await context.close();
}

// --- journey one and two: play a rated game --------------------------------

const tobinContext = await browser.newContext();
const tobin = await signIn(tobinContext, 'tobin_reyes');
let gameUrl = null;

{
  const external = [];
  tobin.on('request', (request) => {
    if (!request.url().startsWith(BASE) && !request.url().startsWith('data:')) external.push(request.url());
  });
  const errors = [];
  tobin.on('pageerror', (error) => errors.push(error.message));

  await tobin.goto(`${BASE}/game/does-not-exist`);
  check('DP-49 a game that does not exist shows the club\'s own not-found page',
    (await tobin.locator('h1').first().textContent()) === 'That game is not here.');
  check('DP-49 the not-found page offers a way back to the hall',
    await tobin.getByRole('link', { name: 'Back to the hall' }).count() === 1);
  await tobin.goto(`${BASE}/challenges`);
  check('journey 1 the challenge from mira_kade is on the challenges page',
    await tobin.locator('.challenge-row', { hasText: 'mira_kade' }).count() >= 1);
  await tobin.getByRole('button', { name: 'Accept' }).first().click();
  await tobin.waitForURL(/\/game\//, { timeout: 15000 });
  gameUrl = tobin.url();
  check('journey 1 accepting lands on the game', /\/game\/[0-9a-f-]+$/.test(gameUrl), gameUrl);
  await tobin.waitForSelector('#board-grid .square');

  // DP-17: three views named exactly, 64 named squares, position in the document.
  for (const label of ['Flat board', 'Deep board', 'Square list']) {
    check(`DP-17 the view switch offers ${label}`, await tobin.getByRole('button', { name: label }).count() === 1);
  }
  equal('DP-17 the board carries 64 squares', await tobin.locator('#board-grid .square').count(), 64);
  const names = await tobin.locator('#board-grid .square').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('aria-label')),
  );
  check('DP-17 each square is named', names.length === 64 && names.every((name) => /^[a-h][1-8](, (White|Black) (Pawn|Knight|Bishop|Rook|Queen|King))?$/.test(name)),
    names.slice(0, 3).join(' / '));
  check('DP-12 a piece keeps one accessible name', names.includes('e2, White Pawn'));
  for (const label of ['Offer draw', 'Claim draw', 'Ask for takeback', 'Resign', 'Rematch']) {
    check(`DP-26 the game offers ${label}`, await tobin.getByRole('button', { name: label }).count() >= 1);
  }
  check('DP-15 the game route offers Skip to board',
    (await tobin.locator('.skip-link').first().textContent()) === 'Skip to board');

  // Journey 1: play a move from the flat board.
  const beforePly = Number(await tobin.locator('#game-screen').getAttribute('data-ply'));
  await tobin.locator('[data-square="e2"]').click();
  check('a selected square is marked', await tobin.locator('[data-square="e2"].is-selected').count() === 1);
  check('legal destinations are marked', await tobin.locator('.square.is-hint').count() >= 2);
  // DP-21: the move animation is a page animation inside its band.
  await tobin.locator('[data-square="e4"]').click();
  const moveAnimations = await tobin.evaluate(() => document.getAnimations()
    .map((animation) => ({
      duration: animation.effect?.getTiming?.().duration,
      iterations: animation.effect?.getTiming?.().iterations,
      target: animation.effect?.target?.className || '',
    })));
  const moveAnimation = moveAnimations.find((animation) => String(animation.target).includes('fly-piece'));
  check('DP-21 the move animation plays on the page inside its band',
    moveAnimation && moveAnimation.duration >= 150 && moveAnimation.duration <= 1200,
    JSON.stringify(moveAnimations));

  await waitFor(tobin, (ply) => Number(document.getElementById('game-screen').dataset.ply) > ply, beforePly);
  check('journey 1 the move list grows', (await tobin.locator('.move-san').count()) >= 1);
  const announcement = await tobin.locator('#move-announcement').textContent();
  check('DP-20 the move is announced in the pinned form', /^Pawn to e4$/.test(announcement.trim()), announcement);
  const liveRegion = await tobin.locator('#live-region').textContent();
  check('DP-20 the announcement reaches a live region', liveRegion.includes('Pawn to e4'), liveRegion);
  check('the piece now stands on its new square',
    await tobin.locator('[data-square="e4"]').getAttribute('aria-label') === 'e4, White Pawn');

  // DP-17: switching views mid-game keeps the position.
  const flatFen = await tobin.locator('#game-screen').getAttribute('data-fen');
  await tobin.getByRole('button', { name: 'Deep board' }).click();
  await tobin.waitForTimeout(1200);
  const deepFen = await tobin.locator('#game-screen').getAttribute('data-fen');
  equal('DP-17 switching to the deep board keeps the position', deepFen, flatFen);
  const deepReady = await tobin.evaluate(() => {
    const canvas = document.getElementById('deep-canvas');
    return {
      visible: getComputedStyle(canvas).display !== 'none',
      webgl: Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')),
      width: canvas.width,
      height: canvas.height,
      squares: document.querySelectorAll('#board-grid .square').length,
    };
  });
  check('DP-17 the deep view draws with hardware graphics',
    deepReady.visible && deepReady.webgl && deepReady.width > 100, JSON.stringify(deepReady));
  equal('DP-17 the 64 squares are present in the deep view too', deepReady.squares, 64);
  const shot = await tobin.locator('#board-frame').screenshot();
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let lit = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] + data[i + 1] + data[i + 2] > 300) lit += 1;
  }
  const share = lit / (info.width * info.height);
  check('DP-18 the deep board is drawn, not blank', share > 0.15, `lit share ${share.toFixed(3)}`);

  // DP-19: the deep board follows the game, and turning the view moves no piece.
  const deepBefore = await tobin.evaluate(() => {
    const node = document.getElementById('game-screen');
    return { fen: node.dataset.fen, ply: node.dataset.ply };
  });
  const canvasBox = await tobin.locator('#deep-canvas').boundingBox();
  await tobin.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await tobin.mouse.down();
  await tobin.mouse.move(canvasBox.x + canvasBox.width / 2 + 120, canvasBox.y + canvasBox.height / 2 - 40, { steps: 12 });
  await tobin.mouse.up();
  await tobin.mouse.wheel(0, -200);
  await tobin.waitForTimeout(600);
  const deepAfter = await tobin.evaluate(() => {
    const node = document.getElementById('game-screen');
    return { fen: node.dataset.fen, ply: node.dataset.ply };
  });
  equal('DP-19 dragging and zooming turn the view without moving a piece', deepAfter, deepBefore);
  const turned = await tobin.locator('#board-frame').screenshot();
  const turnedRaw = await sharp(turned).raw().toBuffer({ resolveWithObject: true });
  let turnedLit = 0;
  for (let i = 0; i < turnedRaw.data.length; i += turnedRaw.info.channels) {
    if (turnedRaw.data[i] + turnedRaw.data[i + 1] + turnedRaw.data[i + 2] > 300) turnedLit += 1;
  }
  check('DP-19 the turned view still draws the board',
    turnedLit / (turnedRaw.info.width * turnedRaw.info.height) > 0.1,
    `${turnedLit}`);

  await tobin.getByRole('button', { name: 'Square list' }).click();
  const squaresView = await tobin.locator('#board-stage').getAttribute('data-view');
  equal('DP-17 the square list view is offered', squaresView, 'squares');
  const squareText = await tobin.locator('[data-square="e4"] .sq-name').textContent();
  equal('the square list names its squares', squareText.trim(), 'e4');
  const listFen = await tobin.locator('#game-screen').getAttribute('data-fen');
  equal('DP-17 the square list holds the same position', listFen, flatFen);
  check('no page errors on the game screen', errors.length === 0, errors.join(' | '));
  check('DP-04 the game page loads nothing from another origin', external.length === 0, external.join(', '));
}

// --- journey 1: the keyboard alone -----------------------------------------

{
  const miraContext = await browser.newContext();
  const mira = await signIn(miraContext, 'mira_kade');
  await mira.goto(`${gameUrl}?view=flat`);
  await mira.waitForSelector('#board-grid .square');
  const side = await mira.locator('#game-screen').getAttribute('data-side');
  check('the opponent sees the same game', side === 'white' || side === 'black', side);
  const flip = await mira.locator('#game-screen').getAttribute('data-flip');
  check('a Black player looks from Black\'s end', (side === 'black') === (flip === '1'));

  // Play a reply with the arrow keys and the enter key alone.
  await mira.getByRole('button', { name: 'Square list' }).click();
  const beforePly = Number(await mira.locator('#game-screen').getAttribute('data-ply'));
  await mira.locator('[data-square="a1"]').focus();
  const target = side === 'black' ? { from: 'e7', to: 'e5' } : { from: 'e2', to: 'e4' };
  // Walk the grid to the square we want, pressing only arrows.
  const walk = async (square) => {
    for (let i = 0; i < 40; i++) {
      const focused = await mira.evaluate(() => document.activeElement?.dataset?.square);
      if (focused === square) return true;
      const files = 'abcdefgh';
      const wantFile = files.indexOf(square[0]);
      const wantRank = Number(square[1]);
      const haveFile = files.indexOf(focused[0]);
      const haveRank = Number(focused[1]);
      if (haveFile < wantFile) await mira.keyboard.press(flip === '1' ? 'ArrowLeft' : 'ArrowRight');
      else if (haveFile > wantFile) await mira.keyboard.press(flip === '1' ? 'ArrowRight' : 'ArrowLeft');
      else if (haveRank < wantRank) await mira.keyboard.press(flip === '1' ? 'ArrowDown' : 'ArrowUp');
      else if (haveRank > wantRank) await mira.keyboard.press(flip === '1' ? 'ArrowUp' : 'ArrowDown');
    }
    return false;
  };
  check('the arrow keys reach any square', await walk(target.from));
  await mira.keyboard.press('Enter');
  check('the enter key picks the piece up', await mira.locator(`[data-square="${target.from}"].is-selected`).count() === 1);
  await mira.keyboard.press('Escape');
  check('the escape key cancels the selection', await mira.locator('.square.is-selected').count() === 0);
  await mira.keyboard.press('Enter');
  check('walking to the destination', await walk(target.to));
  await mira.keyboard.press('Enter');
  const keyboardPlayed = await waitFor(mira,
    (ply) => Number(document.getElementById('game-screen').dataset.ply) > ply, beforePly);
  check('journey 1 a whole move plays from the keyboard alone', keyboardPlayed);
  await miraContext.close();
}

// --- DP-21, DP-22: the six animations --------------------------------------

{
  const context = await browser.newContext();
  const page = await signIn(context, 'jules_amari');
  // A study position where a capture, a promotion and a mate all come quickly.
  const game = await page.evaluate(async () => {
    const response = await fetch('/api/games/from-fen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: '8/6P1/8/4k3/8/8/5q1R/K7 w - - 0 1' }),
    });
    return response.json();
  });
  await page.goto(`${BASE}/game/${game.id}?view=flat`);
  await page.waitForSelector('#board-grid .square');
  await page.waitForTimeout(400);

  // Promotion: the chooser offers all four pieces.
  await page.locator('[data-square="g7"]').click();
  await page.locator('[data-square="g8"]').click();
  for (const label of ['Queen', 'Rook', 'Bishop', 'Knight']) {
    check(`the promotion chooser offers ${label}`, await page.getByRole('button', { name: label, exact: true }).count() === 1);
  }
  await page.getByRole('button', { name: 'Queen', exact: true }).click();
  const promotionAnimations = await page.evaluate(() => document.getAnimations().map((a) => ({
    duration: a.effect?.getTiming?.().duration,
    target: a.effect?.target?.className || '',
  })));
  check('DP-21 the promotion animation plays inside its band',
    promotionAnimations.some((a) => a.duration >= 150 && a.duration <= 1200), JSON.stringify(promotionAnimations));
  await waitFor(page, () => Number(document.getElementById('game-screen').dataset.ply) >= 1);
  const announcement = await page.locator('#move-announcement').textContent();
  equal('DP-20 a promotion is announced in the pinned form', announcement.trim(), 'Pawn to g8, promoted to Queen');

  // A capture, then a mate: the victory and defeat screens.
  await page.locator('[data-square="f2"]').click();
  await page.locator('[data-square="h2"]').click();
  await waitFor(page, () => Number(document.getElementById('game-screen').dataset.ply) >= 2);
  const captureAnnouncement = await page.locator('#move-announcement').textContent();
  check('DP-20 a capture is announced in the pinned form', /^Queen takes h2(, check)?$/.test(captureAnnouncement.trim()),
    captureAnnouncement);
  const captureAnimations = await page.evaluate(() => document.getAnimations().map((a) => a.effect?.getTiming?.().duration));
  check('DP-21 the capture animation plays inside its band',
    captureAnimations.some((duration) => duration >= 150 && duration <= 1200), JSON.stringify(captureAnimations));

  await context.close();
}

// --- DP-22 reduced motion ---------------------------------------------------

{
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await signIn(context, 'jules_amari');
  const game = await page.evaluate(async () => {
    const response = await fetch('/api/games/from-fen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' }),
    });
    return response.json();
  });
  await page.goto(`${BASE}/game/${game.id}?view=flat`);
  await page.waitForSelector('#board-grid .square');
  await page.waitForTimeout(400);
  await page.locator('[data-square="a1"]').click();
  await page.locator('[data-square="a8"]').click();
  await page.waitForSelector('#result-screen', { timeout: 10000 });
  const animations = await page.evaluate(() => document.getAnimations().map((a) => ({
    duration: a.effect?.getTiming?.().duration,
    iterations: a.effect?.getTiming?.().iterations,
  })));
  check('DP-22 under reduced motion nothing runs forever',
    animations.every((a) => a.iterations !== Infinity), JSON.stringify(animations));
  check('DP-22 under reduced motion every animation is instant',
    animations.every((a) => typeof a.duration !== 'number' || a.duration <= 1), JSON.stringify(animations));
  const screen = page.locator('#result-screen');
  const text = await screen.textContent();
  check('DP-22 the result screen keeps every word under reduced motion',
    /You won|White won/.test(text) && text.includes('checkmate')
    && await screen.getByRole('button', { name: 'Rematch' }).count() === 1, text.slice(0, 120));
  const opacity = await screen.evaluate((node) => getComputedStyle(node).opacity);
  check('DP-22 the result screen is fully visible at once', Number(opacity) > 0.95, opacity);
  await context.close();
}

// --- DP-12 the sets, DP-13 the themes --------------------------------------

{
  const context = await browser.newContext();
  const page = await signIn(context, 'wren_oyelaran');
  await page.goto(`${BASE}/settings`);
  const signatures = {};
  for (const set of ['Classic', 'Staunton Flat', 'Neo', 'Pixel']) {
    await page.getByRole('radio', { name: set, exact: true }).check();
    await page.waitForTimeout(250);
    signatures[set] = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#set-preview figure')];
      const wanted = nodes.find((node) => node.dataset.setPreview === document.documentElement.dataset.set2d);
      return wanted ? wanted.querySelector('.preview-row').innerHTML.length + wanted.querySelector('.preview-row').innerHTML.slice(0, 400) : null;
    });
  }
  const values = Object.values(signatures);
  check('DP-12 the four flat sets each draw their pieces differently',
    new Set(values).size === 4, Object.keys(signatures).join(','));

  await page.getByRole('radio', { name: 'Pixel', exact: true }).check();
  await page.getByRole('radio', { name: 'Neon', exact: true }).check();
  await page.waitForTimeout(300);
  equal('journey 4 the choices are applied at once',
    await page.evaluate(() => [document.documentElement.dataset.set2d, document.documentElement.dataset.theme]),
    ['Pixel', 'Neon']);

  // Journey 4: sign out, sign in from another browser.
  const second = await browser.newContext();
  const page2 = await signIn(second, 'wren_oyelaran');
  equal('journey 4 the board is still Pixel on Neon in another browser',
    await page2.evaluate(() => [document.documentElement.dataset.set2d, document.documentElement.dataset.theme]),
    ['Pixel', 'Neon']);

  // DP-13: every theme keeps its squares and labels apart.
  const ratios = await page2.evaluate(() => {
    const luminance = (colour) => {
      const [r, g, b] = colour.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const out = {};
    for (const theme of ['Walnut', 'Slate', 'Ocean', 'Forest', 'Neon']) {
      document.documentElement.dataset.theme = theme;
      const style = getComputedStyle(document.documentElement);
      const probe = document.createElement('div');
      document.body.append(probe);
      probe.style.color = style.getPropertyValue('--sq-light').trim();
      const light = getComputedStyle(probe).color;
      probe.style.color = style.getPropertyValue('--sq-dark').trim();
      const dark = getComputedStyle(probe).color;
      probe.style.color = style.getPropertyValue('--coord-on-light').trim();
      const inkLight = getComputedStyle(probe).color;
      probe.style.color = style.getPropertyValue('--coord-on-dark').trim();
      const inkDark = getComputedStyle(probe).color;
      probe.remove();
      out[theme] = {
        squares: contrast(light, dark),
        labelOnLight: contrast(inkLight, light),
        labelOnDark: contrast(inkDark, dark),
      };
    }
    return out;
  });
  for (const [theme, value] of Object.entries(ratios)) {
    check(`DP-13 ${theme} keeps its squares 3:1 apart`, value.squares >= 3, value.squares.toFixed(2));
    check(`DP-13 ${theme} keeps its labels 4.5:1 on the light square`, value.labelOnLight >= 4.5, value.labelOnLight.toFixed(2));
    check(`DP-13 ${theme} keeps its labels 4.5:1 on the dark square`, value.labelOnDark >= 4.5, value.labelOnDark.toFixed(2));
  }
  await second.close();
  await context.close();
}

// --- DP-16 responsive, DP-18 fit -------------------------------------------

{
  const context = await browser.newContext();
  const page = await signIn(context, 'tobin_reyes');
  const routes = ['/hall', '/challenges', '/leaderboard', '/notifications', '/settings', '/members', '/clubs', '/play'];
  for (const width of [320, 360, 390, 414]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of routes) {
      await page.goto(`${BASE}${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`DP-16 ${route} does not scroll sideways at ${width}`, overflow <= 1, `overflow ${overflow}`);
    }
    await page.goto(`${gameUrl}?view=flat`);
    await page.waitForSelector('#board-grid .square');
    const gameOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`DP-16 the game does not scroll sideways at ${width}`, gameOverflow <= 1, `overflow ${gameOverflow}`);
    const square = await page.locator('#board-frame').boundingBox();
    check(`DP-16 the board stays square at ${width}`, Math.abs(square.width - square.height) <= 2,
      `${square.width} by ${square.height}`);
    const cell = await page.locator('[data-square="a1"]').boundingBox();
    check(`DP-15 a square target is at least 24 by 24 at ${width}`, cell.width >= 24 && cell.height >= 24,
      `${cell.width.toFixed(1)} by ${cell.height.toFixed(1)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${gameUrl}?view=flat`);
  await page.waitForSelector('#board-grid .square');
  const layout = await page.evaluate(() => {
    const board = document.getElementById('board-frame').getBoundingClientRect();
    const side = document.querySelector('.game-side').getBoundingClientRect();
    const rail = getComputedStyle(document.getElementById('rail')).transform;
    const toggle = getComputedStyle(document.getElementById('rail-toggle')).display;
    return { boardWidth: board.width, viewport: window.innerWidth, sideTop: side.top, boardBottom: board.bottom, rail, toggle };
  });
  check('DP-16 at 390 the board is full width', layout.boardWidth >= layout.viewport - 40,
    `${layout.boardWidth} of ${layout.viewport}`);
  check('DP-16 at 390 the side column sits under the board', layout.sideTop >= layout.boardBottom - 2,
    `${layout.sideTop} vs ${layout.boardBottom}`);
  check('DP-16 at 390 the rail is reached through one menu control',
    layout.toggle !== 'none' && layout.rail !== 'none', JSON.stringify(layout));

  // DP-18: the deep board fits a wide desktop and a narrow phone.
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto(`${gameUrl}?view=deep`);
    await page.waitForSelector('#deep-canvas');
    await page.waitForTimeout(1200);
    const fit = await page.evaluate(() => {
      const canvas = document.getElementById('deep-canvas');
      const box = canvas.getBoundingClientRect();
      return {
        left: box.left, right: box.right, width: box.width, height: box.height,
        viewport: window.innerWidth,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(`DP-18 the deep board fits ${size.width} by ${size.height}`,
      fit.left >= -1 && fit.right <= fit.viewport + 1 && fit.sideways <= 1 && fit.width > 100,
      JSON.stringify(fit));
  }
  await context.close();
}

// --- DP-32 leaving and returning, DP-46 live updates -----------------------

{
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  const a = await signIn(aContext, 'tobin_reyes');
  const b = await signIn(bContext, 'mira_kade');
  await a.goto(`${gameUrl}?view=flat`);
  await a.waitForSelector('#board-grid .square');
  const before = {
    fen: await a.locator('#game-screen').getAttribute('data-fen'),
    moves: await a.locator('.move-san').count(),
    turn: await a.locator('#game-screen').getAttribute('data-turn'),
  };
  await a.goto(`${BASE}/leaderboard`);
  await a.goto(`${gameUrl}?view=flat`);
  await a.waitForSelector('#board-grid .square');
  const after = {
    fen: await a.locator('#game-screen').getAttribute('data-fen'),
    moves: await a.locator('.move-san').count(),
    turn: await a.locator('#game-screen').getAttribute('data-turn'),
  };
  equal('DP-32 a game reopened after a trip away shows the same position', after, before);

  // Journey 8: neither page is touched; the move and the message arrive.
  await b.goto(`${gameUrl}?view=flat`);
  await b.waitForSelector('#board-grid .square');
  const turn = await b.locator('#game-screen').getAttribute('data-turn');
  const side = await b.locator('#game-screen').getAttribute('data-side');
  const mover = side === turn ? b : a;
  const watcher = mover === b ? a : b;
  const legal = JSON.parse(await mover.evaluate(async () => {
    const id = document.getElementById('game-screen').dataset.gameId;
    const response = await fetch(`/api/games/${id}/legal-moves`);
    return JSON.stringify(await response.json());
  }));
  const watcherPly = Number(await watcher.locator('#game-screen').getAttribute('data-ply'));
  await mover.locator(`[data-square="${legal[0].slice(0, 2)}"]`).click();
  await mover.locator(`[data-square="${legal[0].slice(2, 4)}"]`).click();
  await waitFor(mover, (ply) => Number(document.getElementById('game-screen').dataset.ply) > ply, watcherPly);
  const arrived = await waitFor(watcher,
    (ply) => Number(document.getElementById('game-screen').dataset.ply) > ply, watcherPly, 5000);
  check('DP-46 journey 8 the opponent\'s move reaches an open page within five seconds', arrived);
  const square = legal[0].slice(2, 4);
  const label = await watcher.locator(`[data-square="${square}"]`).getAttribute('aria-label');
  check('DP-46 the watching page shows the piece on its new square', /, (White|Black) /.test(label), label);

  await mover.locator('#tab-chat').click({ timeout: 2000 }).catch(() => {});
  await mover.locator('#chat-input').fill('Your move, and well played.');
  await mover.getByRole('button', { name: 'Send' }).click();
  const chatArrived = await waitFor(watcher,
    () => [...document.querySelectorAll('.chat-text')].some((node) => node.textContent.includes('well played')),
    null, 5000);
  check('DP-46 journey 8 the message reaches the foot of the chat within five seconds', chatArrived);

  // Journey 5: a spectator may watch but neither reads nor posts the chat.
  const wrenContext = await browser.newContext();
  const wren = await signIn(wrenContext, 'wren_oyelaran');
  await wren.goto(gameUrl);
  await wren.waitForSelector('#board-grid .square');
  check('journey 5 a spectator sees the board', await wren.locator('#board-grid .square').count() === 64);
  check('journey 5 the chat refuses a spectator',
    await wren.locator('.chat-closed').count() === 1 && await wren.locator('#chat-input').count() === 0);
  const refused = await wren.evaluate(async () => {
    const id = document.getElementById('game-screen').dataset.gameId;
    const read = await fetch(`/api/games/${id}/chat`);
    const post = await fetch(`/api/games/${id}/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }),
    });
    const move = await fetch(`/api/games/${id}/moves`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ move: 'a2a3' }),
    });
    return [read.status, post.status, move.status];
  });
  equal('journey 5 a direct call from a spectator is refused by the server', refused, [403, 403, 403]);
  check('journey 5 a spectator has no game controls',
    await wren.getByRole('button', { name: 'Resign' }).count() === 0);
  await wrenContext.close();
  await aContext.close();
  await bContext.close();
}

// --- journey 3: play the house ---------------------------------------------

{
  const context = await browser.newContext();
  const page = await signIn(context, 'jules_amari');
  await page.goto(`${BASE}/play`);
  check('journey 3 the play menu offers both modes',
    await page.getByRole('heading', { name: 'Play a member' }).count() === 1
    && await page.getByRole('heading', { name: 'Play the house' }).count() === 1);
  for (const level of ['Easy', 'Steady', 'Sharp']) {
    check(`journey 3 the house offers ${level}`, await page.getByRole('radio', { name: level, exact: true }).count() === 1);
  }
  await page.getByRole('radio', { name: 'Sharp', exact: true }).check();
  await page.getByRole('button', { name: 'Play the house' }).click();
  await page.waitForURL(/\/game\//, { timeout: 15000 });
  check('journey 3 a house game opens', await page.locator('#board-grid .square').count() === 64);
  check('journey 3 the house is the opponent',
    (await page.locator('.player-name').allTextContents()).some((name) => name.trim() === 'The house'));
  await context.close();
}

console.log('');
console.log(`Browser checks: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const failure of failures) console.log(` - ${failure}`);
}
await browser.close();
process.exit(failures.length ? 1 : 0);
