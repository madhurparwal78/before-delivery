/**
 * The victory, defeat and draw animations, the check pulse, and the deep
 * board following a move made in another view.
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/verify/');
const { chromium } = require('playwright');

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT}`;
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

async function signIn(context, username) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('gambit-demo-pw-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/hall/, { timeout: 15000 });
  return page;
}

async function study(page, fen) {
  const game = await page.evaluate(async (position) => {
    const response = await fetch('/api/games/from-fen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: position }),
    });
    return response.json();
  }, fen);
  await page.goto(`${BASE}/game/${game.id}?view=flat`);
  await page.waitForSelector('#board-grid .square');
  await page.waitForTimeout(400);
  return game;
}

const context = await browser.newContext();
const page = await signIn(context, 'ivo_lindqvist');

// --- the victory and defeat animations --------------------------------------

{
  await study(page, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  await page.locator('[data-square="a1"]').click();
  await page.locator('[data-square="a8"]').click();
  await page.waitForSelector('#result-screen', { timeout: 10000 });
  await page.waitForTimeout(120);
  const animations = await page.evaluate(() => document.getAnimations().map((a) => ({
    duration: a.effect?.getTiming?.().duration,
    iterations: a.effect?.getTiming?.().iterations,
    target: a.effect?.target?.className || '',
  })));
  const inBand = animations.filter((a) => typeof a.duration === 'number' && a.duration >= 150 && a.duration <= 1200);
  check('DP-21 the victory scatter plays on the page inside its band',
    inBand.some((a) => String(a.target).includes('spark')), JSON.stringify(animations).slice(0, 300));
  check('DP-21 the losing king topples inside its band',
    inBand.some((a) => String(a.target).includes('sq-piece')), JSON.stringify(animations).slice(0, 300));
  check('DP-21 the result screen fades up inside its band',
    inBand.some((a) => String(a.target).includes('result-screen')), JSON.stringify(animations).slice(0, 300));
  await page.waitForTimeout(1300);
  const resting = await page.evaluate(() => {
    const loser = [...document.querySelectorAll('.square')]
      .find((node) => node.getAttribute('aria-label') === 'g8, Black King');
    return loser ? getComputedStyle(loser.querySelector('.sq-piece')).transform : null;
  });
  check('a toppled king rests at its angle for as long as the game is open',
    resting && resting !== 'none', String(resting));
  const text = await page.locator('#result-screen').textContent();
  check('the result screen names the reason', text.includes('checkmate'), text.slice(0, 80));
}

// --- the draw animation and its reason --------------------------------------

{
  await study(page, '4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1');
  await page.locator('[data-square="d3"]').click();
  await page.locator('[data-square="e4"]').click();
  await page.waitForSelector('#result-screen', { timeout: 10000 });
  await page.waitForTimeout(120);
  const animations = await page.evaluate(() => document.getAnimations().map((a) => ({
    duration: a.effect?.getTiming?.().duration,
    target: a.effect?.target?.className || '',
  })));
  check('DP-21 the draw animation plays inside its band',
    animations.some((a) => typeof a.duration === 'number' && a.duration >= 150 && a.duration <= 1200),
    JSON.stringify(animations).slice(0, 300));
  const screen = page.locator('#result-screen');
  equal('DP-29 a drawn game reads Drawn', (await screen.locator('.result-heading').textContent()).trim(), 'Drawn');
  const reason = await screen.getAttribute('data-reason');
  equal('DP-29 the draw names exactly the reason that ended it', reason, 'insufficient material');
  check('DP-29 the reason is on the screen for a person to read',
    (await screen.textContent()).includes('insufficient material'));
}

// --- the check pulse --------------------------------------------------------

{
  await study(page, '4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
  await page.locator('[data-square="a2"]').click();
  await page.locator('[data-square="a8"]').click();
  await page.waitForTimeout(900);
  const announcement = (await page.locator('#move-announcement').textContent()).trim();
  equal('DP-20 a checking move ends in check', announcement, 'Rook to a8, check');
  const checked = await page.locator('.square.is-check').count();
  check('a king under attack is marked', checked === 1, `${checked}`);
  const pulse = await page.evaluate(() => document.getAnimations()
    .map((a) => ({ name: a.animationName || '', iterations: a.effect?.getTiming?.().iterations })));
  check('the check pulse runs while the king is attacked',
    pulse.some((a) => a.name === 'check-pulse'), JSON.stringify(pulse));
}

{
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  const quiet = await signIn(reduced, 'ivo_lindqvist');
  await study(quiet, '4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
  await quiet.locator('[data-square="a2"]').click();
  await quiet.locator('[data-square="a8"]').click();
  await quiet.waitForTimeout(900);
  const animations = await quiet.evaluate(() => document.getAnimations()
    .map((a) => ({ name: a.animationName || '', iterations: a.effect?.getTiming?.().iterations })));
  check('DP-22 the check pulse does not run forever under reduced motion',
    animations.every((a) => a.iterations !== Infinity), JSON.stringify(animations));
  await reduced.close();
}

// --- DP-19 the deep board follows a move made in another view ---------------

{
  const game = await study(page, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.getByRole('button', { name: 'Deep board' }).click();
  await page.waitForTimeout(1500);
  const before = await page.locator('#board-frame').screenshot();
  await page.getByRole('button', { name: 'Flat board' }).click();
  await page.waitForTimeout(300);
  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e4"]').click();
  await page.waitForTimeout(800);
  const label = await page.locator('[data-square="e4"]').getAttribute('aria-label');
  equal('the move lands in the flat view', label, 'e4, White Pawn');
  await page.getByRole('button', { name: 'Deep board' }).click();
  await page.waitForTimeout(1500);
  const after = await page.locator('#board-frame').screenshot();
  check('DP-19 the deep board shows the position the move left behind',
    Buffer.compare(before, after) !== 0, 'the deep board did not change');
  const fenNow = await page.locator('#game-screen').getAttribute('data-fen');
  check('DP-19 the deep board and the square list never disagree',
    fenNow.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR'), fenNow);
}

// --- DP-18 a move played by pointing in the deep view ----------------------

/** Where a square's middle lands on the canvas, using the deep view's own camera. */
function projectSquare(rect, square) {
  const TARGET = [0, 0.45, 0];
  const distance = 16.4;
  const elevation = 0.82;
  const eye = [TARGET[0], TARGET[1] + Math.sin(elevation) * distance, TARGET[2] + Math.cos(elevation) * distance];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const length = Math.hypot(...v);
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const forward = norm(sub(TARGET, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const file = 'abcdefgh'.indexOf(square[0]);
  const rank = Number(square[1]);
  const point = [file - 3.5, 0.08, (8 - rank) - 3.5];
  const v = sub(point, eye);
  const depth = dot(v, forward);
  const tanHalf = Math.tan((38 * Math.PI) / 180 / 2);
  const ndcX = (dot(v, right) / depth) / tanHalf;
  const ndcY = (dot(v, up) / depth) / tanHalf;
  return {
    x: rect.x + ((ndcX + 1) / 2) * rect.width,
    y: rect.y + ((1 - ndcY) / 2) * rect.height,
  };
}

{
  await study(page, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.getByRole('button', { name: 'Deep board' }).click();
  await page.waitForTimeout(1600);
  const rect = await page.locator('#deep-canvas').boundingBox();
  const from = projectSquare(rect, 'd2');
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(400);
  const selected = await page.evaluate(() => document.getElementById('game-screen').dataset.fen);
  const to = projectSquare(rect, 'd4');
  await page.mouse.click(to.x, to.y);
  const played = await (async () => {
    for (let i = 0; i < 40; i++) {
      const label = await page.locator('[data-square="d4"]').getAttribute('aria-label');
      if (label === 'd4, White Pawn') return true;
      await page.waitForTimeout(150);
    }
    return false;
  })();
  check('DP-18 a move plays by clicking a piece and then a marked destination in the deep view',
    played, `fen was ${selected}`);
}

// --- DP-46 a draw offer reaches the other player's open page ---------------

{
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  const a = await signIn(aContext, 'nadia_serrano');
  const b = await signIn(bContext, 'ivo_lindqvist');
  const challenge = await a.evaluate(async () => {
    const response = await fetch('/api/challenges', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opponent: 'ivo_lindqvist', colour: 'White', rated: false }),
    });
    return response.json();
  });
  const game = await b.evaluate(async (id) => {
    const response = await fetch(`/api/challenges/${id}/accept`, {
      method: 'POST', headers: { 'Idempotency-Key': `ui-${id}` },
    });
    return response.json();
  }, challenge.id);
  await a.goto(`${BASE}/game/${game.id}?view=flat`);
  await b.goto(`${BASE}/game/${game.id}?view=flat`);
  await a.waitForSelector('#board-grid .square');
  await b.waitForSelector('#board-grid .square');
  await a.getByRole('button', { name: 'Offer draw' }).click();
  const offerArrived = await (async () => {
    for (let i = 0; i < 34; i++) {
      if (await b.locator('[data-offer="draw"]').count()) return true;
      await b.waitForTimeout(150);
    }
    return false;
  })();
  check('DP-46 a draw offer reaches the opponent\'s open page within five seconds', offerArrived);
  check('DP-46 the offer carries its Accept and Decline controls',
    await b.getByRole('button', { name: 'Accept' }).count() === 1
    && await b.getByRole('button', { name: 'Decline' }).count() === 1);
  await b.getByRole('button', { name: 'Accept' }).click();
  await b.waitForSelector('#result-screen', { timeout: 10000 });
  const heading = (await b.locator('.result-heading').textContent()).trim();
  equal('DP-29 an accepted offer draws the game', heading, 'Drawn');
  const reason = await b.locator('#result-screen').getAttribute('data-reason');
  equal('DP-29 and the reason reads agreement', reason, 'agreement');
  const sameForBoth = await (async () => {
    for (let i = 0; i < 34; i++) {
      if (await a.locator('#result-screen').count()) {
        return [
          (await a.locator('.result-heading').textContent()).trim(),
          await a.locator('#result-screen').getAttribute('data-reason'),
        ];
      }
      await a.waitForTimeout(150);
    }
    return null;
  })();
  equal('DP-29 both players see the same screen and the same reason', sameForBoth, ['Drawn', 'agreement']);
  await aContext.close();
  await bContext.close();
}

console.log('');
console.log(`Outcome checks: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const failure of failures) console.log(` - ${failure}`);
}
await browser.close();
process.exit(failures.length ? 1 : 0);
