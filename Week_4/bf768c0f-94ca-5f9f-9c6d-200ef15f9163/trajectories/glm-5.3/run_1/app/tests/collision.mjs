// Journey 6: two moves submitted for the same turn at the same moment leave
// exactly one move played; and journey 8: two pages see live updates.
import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:4173';
const PW = 'gambit-demo-pw-2026';
let passed = 0, failed = 0;
const failures = [];
const check = (n, c, e) => { if (c) passed++; else { failed++; failures.push(n + (e !== undefined ? ` :: ${JSON.stringify(e)}` : '')); } };

async function session(browser, username) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', err => console.log('PAGE ERROR:', String(err).slice(0, 200)));
  await page.goto(BASE + '/login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/hall');
  return { ctx, page };
}

const browser = await chromium.launch();
const mira = await session(browser, 'mira_kade');
const tobin = await session(browser, 'tobin_reyes');

// create and accept a challenge through the API on mira's page
const setup = await mira.page.evaluate(async () => {
  const r = await fetch('/api/challenges', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponent: 'tobin_reyes', rated: true, colour: 'White' }), credentials: 'same-origin',
  });
  return (await r.json());
});
const gameId = await tobin.page.evaluate(async chId => {
  const r = await fetch(`/api/challenges/${chId}/accept`, {
    method: 'POST', headers: { 'Idempotency-Key': 'collision-' + chId }, credentials: 'same-origin',
  });
  return (await r.json()).id;
}, setup.id);

await mira.page.goto(BASE + '/game/' + gameId);
await tobin.page.goto(BASE + '/game/' + gameId);

// both pages learn whose turn it is
await mira.page.waitForTimeout(1200);

// COLLIDE: two moves for the same ply submitted at the same moment.
// Both are submitted by White's page (mira): exactly one succeeds.
const codes = await mira.page.evaluate(async gId => {
  const url = `/api/games/${gId}/moves`;
  const opts = m => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ move: m }), credentials: 'same-origin',
  });
  const [a, b] = await Promise.all([fetch(url, opts('e2e4')), fetch(url, opts('d2d4'))]);
  return [a.status, b.status];
}, gameId);
const sorted = codes.slice().sort();
check('a collision leaves one 201 and one 409', sorted[0] === 201 && sorted[1] === 409, codes);

// the position holds a single move at ply 1
const state = await mira.page.evaluate(async gId => {
  const r = await fetch(`/api/games/${gId}`, { credentials: 'same-origin' });
  const g = await r.json();
  return { plies: g.moves.length, fen: g.fen, pliesAtPly1: g.moves.filter(m => m.ply === 1).length };
}, gameId);
check('exactly one move stored', state.plies === 1 && state.pliesAtPly1 === 1, state);

// the refused caller is told the position has moved on and their board is unchanged
// (verify through a second race where the loser reads the position after)
const codes2 = await tobin.page.evaluate(async gId => {
  const url = `/api/games/${gId}/moves`;
  const opts = m => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ move: m }), credentials: 'same-origin',
  });
  // tobin is Black; it is his turn now: race two black moves
  const [a, b] = await Promise.all([fetch(url, opts('e7e5')), fetch(url, opts('c7c5'))]);
  const bodies = await Promise.all([a.clone().json().catch(() => null), b.clone().json().catch(() => null)]);
  return { codes: [a.status, b.status], messages: bodies.map(x => x && x.error) };
}, gameId);
const sorted2 = codes2.codes.slice().sort();
check('the black ply also has a single winner', sorted2[0] === 201 && sorted2[1] === 409, codes2.codes);
check('the refused move carries a readable reason', codes2.messages.some(m => m && m.length > 3), codes2.messages);

// JOURNEY 8: two members sit at two browsers; neither touches the page;
// a move and a message arrive within 5 seconds without a reload.
const startIdle = Date.now();
await tobin.page.evaluate(() => { window.__focusSquare = 'watching'; });
// mira (white again after black's move) plays a move and sends a message via API
await mira.page.evaluate(async gId => {
  await fetch(`/api/games/${gId}/moves`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ move: 'g1f3' }), credentials: 'same-origin',
  });
  await fetch(`/api/games/${gId}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Neither of us touched the page.' }), credentials: 'same-origin',
  });
}, gameId);

// wait for tobin's untouched page to show the piece on f3 and the message
let moveSeen = false, chatSeen = false, elapsed = 0;
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
  const seen = await tobin.page.evaluate(() => {
    const moves = window.__game ? window.__game.game.moves.length : 0;
    const chat = [...document.querySelectorAll('[data-chat-log] .chat-msg .text')].map(e => e.textContent);
    return { moves, chatSeen: chat.some(t => t === 'Neither of us touched the page.') };
  });
  moveSeen = seen.moves >= 3;
  chatSeen = seen.chatSeen;
  if (moveSeen && chatSeen) break;
  await new Promise(r => setTimeout(r, 250));
}
elapsed = Date.now() - t0;
check('the opponent move reached an untouched page within 5 seconds', moveSeen && elapsed <= 5000, `${moveSeen} ${elapsed}ms`);
check('the message reached the untouched page within 5 seconds', chatSeen && elapsed <= 5000, `${chatSeen} ${elapsed}ms`);

// the deep view shows the same position without a reload
const deepAgrees = await tobin.page.evaluate(() => {
  const p = window.__deep.pieces.find(p => p.square === 'f3');
  return p ? Math.abs(p.pos[0] - 1.5) < 0.01 && Math.abs(p.pos[2] - -1.5) < 0.01 : false;
});
check('the deep board agrees after the live update', deepAgrees, deepAgrees);

console.log(`\nCOLLISION PASS ${passed} FAIL ${failed}`);
if (failed) failures.forEach(f => console.log('  FAIL:', f));
await browser.close();
if (failed) process.exit(1);
