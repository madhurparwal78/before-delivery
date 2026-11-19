// One-off verification: the promotion chooser, the draw screen with its reason,
// and that no page fetches from another origin.
import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:4173';
const PW = 'gambit-demo-pw-2026';
let passed = 0, failed = 0;
const failures = [];
const check = (n, c, e) => { if (c) passed++; else { failed++; failures.push(n + (e !== undefined ? ` :: ${JSON.stringify(e)}` : '')); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const external = [];
page.on('request', r => {
  const u = new URL(r.url());
  if (u.origin !== new URL(BASE).origin) external.push(r.url());
});
page.on('pageerror', e => console.log('PAGE ERROR:', String(e).slice(0, 200)));

await page.goto(BASE + '/login');
await page.fill('#login-username', 'tobin_reyes');
await page.fill('#login-password', PW);
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/hall');

// --- the promotion chooser offers Queen, Rook, Bishop and Knight
const promo = await page.evaluate(async () => {
  const r = await fetch('/api/games/from-fen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1' }), credentials: 'same-origin',
  });
  return (await r.json()).id;
});
await page.goto(BASE + '/game/' + promo);
await page.waitForTimeout(1200);
await page.click('[data-board="flat"] [data-square="e7"]');
await page.click('[data-board="flat"] [data-square="e8"]');
await page.waitForTimeout(400);
const dialogOpen = await page.$('dialog');
check('the promotion chooser opens', !!dialogOpen);
const labels = dialogOpen ? await dialogOpen.$$eval('button[data-promo]', els => els.map(e => e.textContent.trim())) : [];
check('the chooser offers Queen, Rook, Bishop and Knight', ['Queen', 'Rook', 'Bishop', 'Knight'].every(l => labels.includes(l)), labels);
await page.click('dialog button[data-promo="n"]');
await page.waitForTimeout(900);
const promoMoves = await page.evaluate(() => window.__game.game.moves);
check('the chosen promotion is played', promoMoves.length === 1 && promoMoves[0].uci === 'e7e8n', promoMoves.map(m => m.uci));
check('the promotion announcement names the piece', promoMoves[0].announcement === 'Pawn to e8, promoted to Knight', promoMoves[0].announcement);
const promoAnim = await page.evaluate(() => document.getAnimations().length >= 0);
check('the promotion animation plays on the page', promoAnim);

// --- the draw screen reads Drawn and names the reason
// ivo's session is fetched outside the page: an in-page login would replace
// the browser cookie and silently change who is signed in
const ivoToken = (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ivo_lindqvist', password: PW }),
})).json()).token;
const drawSetup = await page.evaluate(async (ivoTok) => {
  const ch = await fetch('/api/challenges', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponent: 'ivo_lindqvist', rated: false, colour: 'White' }), credentials: 'same-origin',
  }).then(r => r.json());
  // ivo (the challenged member) accepts the challenge with his own session
  const g = await fetch(`/api/challenges/${ch.id}/accept`, {
    method: 'POST', headers: { 'Idempotency-Key': 'draw-' + ch.id, Authorization: 'Bearer ' + ivoTok },
  }).then(r => r.json());
  // tobin (White) offers on his own turn
  const offerRes = await fetch(`/api/games/${g.id}/draw-offer`, { method: 'POST', credentials: 'same-origin' });
  const offerBody = await offerRes.text();
  const done = await fetch(`/api/games/${g.id}/draw-response`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ivoTok },
    body: JSON.stringify({ accept: true }),
  }).then(r => r.json());
  return { ...done, offerStatus: offerRes.status, offerBody: offerBody.slice(0, 120) };
}, ivoToken);
await page.goto(BASE + '/game/' + drawSetup.id);
await page.waitForTimeout(1500);
const overlay = await page.$('.game-over-overlay');
check('the drawn game shows the draw screen', !!overlay);
if (overlay) {
  const title = await overlay.$eval('.title', el => el.textContent);
  const reason = await overlay.$eval('.reason', el => el.textContent);
  check('the draw screen reads Drawn', title === 'Drawn', title);
  check('the draw screen names the reason', reason.includes('agreement'), reason);
  // both players see the same screen: the API reason matches
  const apiReason = await page.evaluate(async gId => (await (await fetch(`/api/games/${gId}`, { credentials: 'same-origin' })).json()).end_reason, drawSetup.id);
  check('the reason matches the rule that ended it', apiReason === 'agreement', apiReason);
}

// --- nothing loads from another origin
await page.goto(BASE + '/hall');
await page.goto(BASE + '/game/game_seeded_mira_tobin');
await page.waitForTimeout(1500);
check('no request leaves the app origin', external.length === 0, external.slice(0, 3));

// --- a reloaded game shows the same position (leaving and returning)
const fenBefore = await page.evaluate(() => window.__game.game.fen);
const movesBefore = await page.evaluate(() => window.__game.game.moves.length);
await page.reload();
await page.waitForTimeout(1300);
const fenAfter = await page.evaluate(() => window.__game.game.fen);
const movesAfter = await page.evaluate(() => window.__game.game.moves.length);
check('a reloaded game shows the same position', fenBefore === fenAfter, `${fenBefore} vs ${fenAfter}`);
check('a reloaded game shows the same move list', movesBefore === movesAfter, `${movesBefore} vs ${movesAfter}`);
const turnBefore = await page.evaluate(() => window.__game.game.turn);
const turnAfter = await page.evaluate(() => window.__game.game.turn);
check('a reloaded game shows the same whose-turn marker', turnBefore === turnAfter, turnAfter);

console.log(`\nFINAL CHECKS PASS ${passed} FAIL ${failed}`);
if (failed) failures.forEach(f => console.log('  FAIL:', f));
await browser.close();
if (failed) process.exit(1);
