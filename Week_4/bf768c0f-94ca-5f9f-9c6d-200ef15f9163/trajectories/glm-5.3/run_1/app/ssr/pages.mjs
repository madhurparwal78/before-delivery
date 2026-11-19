// Server-rendered pages for every route. Content is in the first response.
import { query } from '../lib/db.mjs';
import { parseFen, sqToName, START_FEN } from '../lib/chess.mjs';
import { canSeeGame, loadGame, houseSide } from '../lib/games.mjs';
import { avatarUrlOf } from './avatar.mjs';
import { pieceSvg } from '../public/src/pieces-2d.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PIECE_LETTERS = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

function icon(name, { label = '' } = {}) {
  const paths = {
    play: '<path d="M8 5v14l11-7z"/>',
    swords: '<path d="M4 4l7 7M20 4l-7 7M4 4h3M4 4v3M20 4h-3M20 4v3M7 20l-3-3 9-9 3 3-9 9zM17 20l3-3-9-9-3 3 9 9z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2"/>',
    bell: '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 18a2 2 0 0 0 4 0"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6z" fill="none" stroke="currentColor" stroke-width="2"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0z"/>',
    group: '<circle cx="9" cy="8" r="3.4"/><circle cx="16" cy="9" r="2.8"/><path d="M3 20a6 6 0 0 1 12 0zM15 20a5 5 0 0 1 6-4.6"/>',
    ladder: '<path d="M6 3v18M18 3v18M6 7h12M6 12h12M6 17h12" stroke="currentColor" stroke-width="2" fill="none"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v9m0 0l8-4.5M12 12L4 7.5" stroke="currentColor" stroke-width="2" fill="none"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2"/>',
    keyboard: '<rect x="3" y="7" width="18" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 13h10"/>',
    gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="2"/>',
    speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2"/>',
    speakerOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2"/>',
    flag: '<path d="M6 3v18M6 4h12l-2.5 4L18 12H6z"/>',
    equals: '<path d="M5 9h14M5 15h14" stroke="currentColor" stroke-width="2.4" fill="none"/>',
    takeback: '<path d="M9 14l-5-5 5-5M4 9h11a5 5 0 0 1 0 10H9" fill="none" stroke="currentColor" stroke-width="2"/>',
    download: '<path d="M12 3v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2"/>',
    upload: '<path d="M12 21V10m0 0L8 14m4-4l4 4M5 5h14" fill="none" stroke="currentColor" stroke-width="2"/>',
    knight: '<path d="M6 21h12l-1-6c0-6-3-9-8-10l-1 3 3 3-4 3z"/><circle cx="10.5" cy="9" r="0.8" fill="var(--ground)"/>',
    search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2"/>',
  };
  const inner = paths[name] || paths.play;
  const aria = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"${aria}>${inner}</svg>`;
}

function head(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Gambit Hall</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="icon" href="/media/avatars/house.svg" type="image/svg+xml">
</head>`;
}

async function unreadCount(member) {
  if (!member) return 0;
  const r = await query('SELECT count(*) AS n FROM notifications WHERE member_id=$1 AND read=FALSE', [member.id]);
  return Number(r.rows[0].n);
}

function accountBlock(member) {
  return `<div class="account">
  <div style="display:flex;align-items:center;gap:10px">
    <img class="avatar" src="${esc(avatarUrlOf(member))}" alt="">
    <div>
      <div class="self" style="font-weight:700;color:var(--green)">${esc(member.username)}</div>
      <div class="mono" style="font-size:12px;color:var(--text-75)">${member.rating}${member.rated_games < 10 ? '?' : ''}</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-top:10px">
    <a class="btn btn-quiet btn-sm" href="/settings">${icon('gear', 'Settings')}<span>Settings</span></a>
    <button class="btn btn-quiet btn-sm" data-action="signout">${icon('flag', 'Sign out')}<span>Sign out</span></button>
  </div>
</div>`;
}

async function shell(pathname, member, bodyHtml, { title } = {}) {
  const unread = await unreadCount(member);
  const nav = [
    ['/play', 'Play', 'play'],
    ['/challenges', 'Challenges', 'swords'],
    ['/clubs', 'Clubs', 'shield'],
    ['/members', 'Members', 'person'],
    ['/leaderboard', 'Leaderboard', 'ladder'],
    ['/notifications', 'Notifications', 'bell'],
  ];
  const navHtml = nav.map(([href, label, ic]) => {
    const current = pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
    const badge = href === '/notifications' ? `<span class="badge ${unread === 0 ? 'zero' : ''}" data-unread>${unread}</span>` : '';
    return `<a class="nav-item" href="${href}" ${current ? 'aria-current="page"' : ''}>${icon(ic, label)}<span>${label}</span>${badge}</a>`;
  }).join('');
  const admin = member && member.role === 'administrator'
    ? `<a class="nav-item" href="/admin/games" ${pathname.startsWith('/admin') ? 'aria-current="page"' : ''}>${icon('shield', 'Admin games')}<span>Admin games</span></a>`
    : '';
  return `${head(title)}
<body>
<a class="skip" href="#board">Skip to board</a>
<a class="skip" href="#content">Skip to content</a>
<button class="rail-toggle" data-action="open-rail" aria-label="Open the hall menu">${icon('grid', 'Open the hall menu')}</button>
<div class="app-shell">
  <nav class="rail" aria-label="Hall">
    <a class="mark" href="/hall">${icon('knight', 'Gambit Hall')}<span>Gambit Hall</span></a>
    ${navHtml}
    ${admin}
    <form class="rail-search" action="/members" method="get" role="search">
      <label for="rail-q" class="sr-only">Search members</label>
      <input id="rail-q" name="q" placeholder="Search members" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--ground);color:var(--text)">
    </form>
    ${member ? accountBlock(member) : ''}
  </nav>
  <main class="pane" id="content" tabindex="-1">
    ${bodyHtml}
  </main>
</div>
<div id="live-announcer" aria-live="polite" aria-atomic="true"></div>
<div class="toasts" aria-live="polite"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function publicShell(bodyHtml, { title }) {
  return `${head(title)}
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="public-shell">
  <header class="topbar">
    <a class="mark" href="/" style="display:flex;align-items:center;gap:10px;font-family:var(--serif);font-size:1.15rem;color:var(--text)">${icon('knight', 'Gambit Hall')}<span>Gambit Hall</span></a>
    <div class="actions">
      <a href="/login" class="btn btn-quiet">Sign in</a>
      <a href="/join" class="btn btn-primary"><span class="label">Join the hall</span></a>
    </div>
  </header>
  <main id="content" tabindex="-1" style="flex:1;display:flex;align-items:center;justify-content:center;padding:20px">
    ${bodyHtml}
  </main>
</div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

// ------------------------------------------------------------------ boards

// Renders the 64 squares with occupants for the flat view (SSR), pieces included.
function renderFlatBoard(fen, pieceSet = 'Classic') {
  const pos = parseFen(fen);
  const files = 'abcdefgh';
  let html = `<div class="board-outer" data-board="flat">
    <div class="board-grid">`;
  for (let r = 7; r >= 0; r--) {
    for (let f = 0; f < 8; f++) {
      const i = r * 8 + f;
      const p = pos.board[i];
      const light = (f + r) % 2 === 1;
      const name = files[f] + (r + 1);
      const occ = p ? `, ${p.c === 'w' ? 'White' : 'Black'} ${PIECE_LETTERS[p.t]}` : '';
      html += `<div class="sq2 ${light ? 'light' : 'dark'}" data-square="${name}" data-occupant="${p ? (p.c === 'w' ? 'w' : 'b') + p.t : ''}" aria-label="${name}${esc(occ)}">
        ${f === 0 ? `<span class="coords coord-rank">${r + 1}</span>` : ''}
        ${r === 0 ? `<span class="coords coord-file">${files[f]}</span>` : ''}
        ${p ? `<span class="piece" data-piece="${(p.c === 'w' ? 'w' : 'b') + p.t}">${pieceSvg((p.c === 'w' ? 'w' : 'b') + p.t, pieceSet)}</span>` : ''}
      </div>`;
    }
  }
  html += `</div></div>`;
  return html;
}

// Renders the accessible 64-square keyboard board (SSR, present alongside both views).
function renderKbdBoard(fen) {
  const pos = parseFen(fen);
  const files = 'abcdefgh';
  let html = `<div class="kbd-board" data-board="keys" role="group" aria-label="Square list keyboard board">`;
  for (let r = 7; r >= 0; r--) {
    for (let f = 0; f < 8; f++) {
      const i = r * 8 + f;
      const p = pos.board[i];
      const light = (f + r) % 2 === 1;
      const name = files[f] + (r + 1);
      const label = p ? `${name}, ${p.c === 'w' ? 'White' : 'Black'} ${PIECE_LETTERS[p.t]}` : name;
      html += `<button type="button" class="${light ? 'kbd-light' : 'kbd-dark'}" data-square="${name}" aria-label="${esc(label)}" title="${esc(label)}">${name}</button>`;
    }
  }
  html += `</div>`;
  return html;
}

function sideShape(side) {
  if (!side || side.id === 'mem_the_house' || side.username === 'The house') return houseSide();
  return side;
}

function playerStrip(side, { turn } = {}) {
  const s = sideShape(side);
  return `<div class="player-strip">
  <img class="avatar avatar-lg" src="${esc(s.avatar_url)}" alt="">
  <span class="turn-marker ${turn ? 'on' : ''}" aria-hidden="true"></span>
  <span class="name" data-player-name="${esc(s.username)}">${esc(s.username)}</span>
  <span class="rating" data-player-rating="${esc(s.username)}">${s.rating_display ?? ''}</span>
</div>`;
}

// ------------------------------------------------------------------ pages

export async function renderPage(route, ctx = {}) {
  const { member, req } = ctx;
  const pathname = req ? new URL(req.url, 'http://x').pathname : route;
  switch (route) {
    case '/': return welcomePage(ctx);
    case '/login': return loginPage(ctx);
    case '/join': return joinPage(ctx);
    case '/hall': return hallPage(ctx, pathname);
    case '/play': return playPage(ctx, pathname);
    case '/challenges': return challengesPage(ctx, pathname);
    case '/clubs': return clubsPage(ctx, pathname);
    case '/clubs/slug': return clubDetailPage(ctx, pathname);
    case '/members': return membersPage(ctx, pathname);
    case '/members/username': return memberDetailPage(ctx, pathname);
    case '/leaderboard': return leaderboardPage(ctx, pathname);
    case '/notifications': return notificationsPage(ctx, pathname);
    case '/settings': return settingsPage(ctx, pathname);
    case '/admin/games': return adminGamesPage(ctx, pathname);
    case '/game/view': return gamePage(ctx, pathname);
    case '/game/record': return recordPage(ctx, pathname);
    default: return notFoundPage(ctx, pathname);
  }
}

// ---- public pages

function welcomePage() {
  const board = renderFlatBoard(START_FEN);
  return publicShell(`
  <div style="max-width:920px;width:100%">
    <h1 style="font-size:clamp(1.8rem, 5vw, 2.6rem);margin-bottom:6px">Gambit Hall</h1>
    <p style="color:var(--text-75);max-width:46ch">A quiet club room where the board is the only thing that matters. Play a rated game with a member, or sit down with the house. No clock, no noise, no tracking of any kind.</p>
    <div class="card frosted" style="margin:18px 0;max-width:420px">
      <div class="board-frame" style="max-width:none">${board}</div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <a class="btn btn-primary" href="/join"><span class="label">Join the hall</span></a>
      <a class="btn" href="/login">Sign in</a>
    </div>
  </div>`, { title: 'Welcome' });
}

function loginPage() {
  return publicShell(`
  <div class="card" style="max-width:400px;width:100%">
    <h1>Sign in</h1>
    <form data-form="login" novalidate>
      <div class="field">
        <label for="login-username">Username</label>
        <input id="login-username" name="email" autocomplete="username" required>
        <div class="error" data-error-for="login-username" role="alert"></div>
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <div class="error" data-error-for="login-password" role="alert"></div>
      </div>
      <button class="btn btn-primary" type="submit"><span class="label">Sign in</span></button>
      <p class="form-error" data-form-error role="alert"></p>
    </form>
    <p style="margin-top:14px;color:var(--text-75)">New here? <a href="/join">Join the hall</a>.</p>
  </div>`, { title: 'Sign in' });
}

function joinPage() {
  return publicShell(`
  <div class="card" style="max-width:420px;width:100%">
    <h1>Join the hall</h1>
    <form data-form="join" novalidate>
      <div class="field">
        <label for="join-username">Username</label>
        <input id="join-username" name="username" autocomplete="username" required>
        <div class="error" data-error-for="join-username" role="alert"></div>
      </div>
      <div class="field">
        <label for="join-email">Email</label>
        <input id="join-email" name="email" type="email" autocomplete="email" required>
        <div class="error" data-error-for="join-email" role="alert"></div>
      </div>
      <div class="field">
        <label for="join-password">Password</label>
        <input id="join-password" name="password" type="password" autocomplete="new-password" required>
        <div class="error" data-error-for="join-password" role="alert"></div>
      </div>
      <button class="btn btn-primary" type="submit"><span class="label">Join the hall</span></button>
      <p class="form-error" data-form-error role="alert"></p>
    </form>
  </div>`, { title: 'Join' });
}

// ---- member pages

async function hallPage(ctx, pathname) {
  const { member } = ctx;
  const games = await query(
    `SELECT g.*, w.username AS wname, b.username AS bname FROM games g
     JOIN members w ON w.id = g.white_id JOIN members b ON b.id = g.black_id
     WHERE (g.white_id=$1 OR g.black_id=$1) AND g.status='in_progress' ORDER BY g.last_move_at DESC`, [member.id]);
  const challenges = await query(
    `SELECT c.*, f.username AS fname, t.username AS tname FROM challenges c
     JOIN members f ON f.id = c.from_id JOIN members t ON t.id = c.to_id
     WHERE (c.from_id=$1 OR c.to_id=$1) AND c.status='pending' ORDER BY c.created_at DESC`, [member.id]);
  const rows = games.rows.map(g => {
    const mine = g.white_id === member.id;
    const opp = mine ? g.bname : g.wname;
    const colour = mine ? 'White' : 'Black';
    const turn = parseFen(g.fen).turn;
    return `<tr><td><a href="/game/${esc(g.id)}">vs ${esc(opp)}</a></td><td>${colour}</td><td>${turn === (mine ? 'w' : 'b') ? '<span style="color:var(--green)">your move</span>' : '<span style="color:var(--text-50)">their move</span>'}</td><td>${g.rated ? 'rated' : 'unrated'}</td></tr>`;
  }).join('');
  const chRows = challenges.rows.map(c => {
    const incoming = c.to_id === member.id;
    return `<tr><td>${incoming ? 'from' : 'to'} ${esc(incoming ? c.fname : c.tname)}</td><td>${c.rated ? 'rated' : 'unrated'}</td>
      <td>${incoming ? `<a class="btn btn-sm btn-primary" href="/challenges"><span class="label">Accept</span></a>` : 'sent'}</td></tr>`;
  }).join('');
  const body = `
  <div class="page">
    <h1>The hall</h1>
    <p style="color:var(--text-75)">Welcome back, ${esc(member.username)}. Your games sit where you left them.</p>
    <section class="card"><h2 class="card-title">Games in progress</h2>
      ${games.rows.length ? `<table class="grid"><thead><tr><th>Game</th><th>Your colour</th><th>Turn</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No games in progress. <a href="/play">Start one</a>.</div>`}
    </section>
    <section class="card"><h2 class="card-title">Open challenges</h2>
      ${challenges.rows.length ? `<table class="grid"><thead><tr><th>Challenge</th><th></th><th></th></tr></thead><tbody>${chRows}</tbody></table>` : `<div class="empty">No challenges yet. <a href="/challenges">Send one</a>.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'The hall' });
}

function playPage(ctx, pathname) {
  const { member } = ctx;
  const body = `
  <div class="page" style="max-width:560px">
    <h1>Play</h1>
    <section class="card">
      <h2 class="card-title">Play a member</h2>
      <form data-form="challenge" novalidate>
        <div class="field">
          <label for="ch-opponent">Opponent</label>
          <input id="ch-opponent" name="opponent" required>
          <div class="error" data-error-for="ch-opponent" role="alert"></div>
        </div>
        <div class="field">
          <label for="ch-colour">Colour</label>
          <select id="ch-colour" name="colour">
            <option value="White">White</option>
            <option value="Black">Black</option>
            <option value="Random">Random</option>
          </select>
        </div>
        <div class="field">
          <label for="ch-rated"><input type="checkbox" id="ch-rated" name="rated" checked style="width:auto;min-height:0"> Rated game</label>
        </div>
        <button class="btn btn-primary" type="submit"><span class="label">Send challenge</span></button>
        <p class="form-error" data-form-error role="alert"></p>
      </form>
    </section>
    <section class="card">
      <h2 class="card-title">Play the house</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-house-level="easy">Easy</button>
        <button class="btn" data-house-level="steady">Steady</button>
        <button class="btn btn-primary" data-house-level="sharp"><span class="label">Sharp</span></button>
      </div>
      <p style="color:var(--text-75);font-size:13px;margin:10px 0 0">House games are never rated. The house replies to your move as soon as you make it.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Study a position</h2>
      <form data-form="from-fen" novalidate>
        <div class="field">
          <label for="fen-input">Position record (FEN)</label>
          <input id="fen-input" name="fen" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">
          <div class="error" data-error-for="fen-input" role="alert"></div>
        </div>
        <button class="btn" type="submit">Open the study board</button>
      </form>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Play' });
}

async function challengesPage(ctx, pathname) {
  const { member } = ctx;
  const challenges = await query(
    `SELECT c.*, f.username AS fname, t.username AS tname, cl.slug AS club_slug,
            f.avatar_key AS fkey, f.id AS fid
     FROM challenges c JOIN members f ON f.id = c.from_id JOIN members t ON t.id = c.to_id
     LEFT JOIN clubs cl ON cl.id = c.club_id
     WHERE c.from_id=$1 OR c.to_id=$1 ORDER BY c.created_at DESC`, [member.id]);
  const incoming = challenges.rows.filter(c => c.to_id === member.id);
  const outgoing = challenges.rows.filter(c => c.from_id === member.id);
  const row = (c, incomingSide) => {
    const other = incomingSide ? c.fname : c.tname;
    const actions = incomingSide && c.status === 'pending'
      ? `<button class="btn btn-sm btn-primary" data-accept="${esc(c.id)}"><span class="label">Accept</span></button>
         <button class="btn btn-sm" data-decline="${esc(c.id)}">Decline</button>`
      : (c.status === 'accepted' && c.game_id ? `<a class="btn btn-sm" href="/game/${esc(c.game_id)}">Open game</a>` : `<span style="color:var(--text-50)">${esc(c.status)}</span>`);
    return `<tr>
      <td>${esc(other)}</td>
      <td>${c.rated ? 'rated' : 'unrated'}</td>
      <td>${esc(c.colour)}${c.club_slug ? ` · ${esc(c.club_slug)}` : ''}</td>
      <td>${actions}</td>
    </tr>`;
  };
  const body = `
  <div class="page">
    <h1>Challenges</h1>
    <section class="card">
      <h2 class="card-title">Received</h2>
      ${incoming.length ? `<table class="grid"><thead><tr><th>From</th><th></th><th>Colour</th><th></th></tr></thead><tbody>${incoming.map(c => row(c, true)).join('')}</tbody></table>` : `<div class="empty">No challenges yet. <a href="/play">Challenge a member</a>.</div>`}
    </section>
    <section class="card">
      <h2 class="card-title">Sent</h2>
      ${outgoing.length ? `<table class="grid"><thead><tr><th>To</th><th></th><th>Colour</th><th></th></tr></thead><tbody>${outgoing.map(c => row(c, false)).join('')}</tbody></table>` : `<div class="empty">Nothing sent yet.</div>`}
    </section>
    <section class="card">
      <h2 class="card-title">Send a new challenge</h2>
      <form data-form="challenge" novalidate>
        <div class="field"><label for="ch-opponent">Opponent</label><input id="ch-opponent" name="opponent" required><div class="error" data-error-for="ch-opponent" role="alert"></div></div>
        <div class="field"><label for="ch-colour">Colour</label>
          <select id="ch-colour" name="colour"><option value="White">White</option><option value="Black">Black</option><option value="Random">Random</option></select>
        </div>
        <div class="field"><label for="ch-rated"><input type="checkbox" id="ch-rated" name="rated" checked style="width:auto;min-height:0"> Rated game</label></div>
        <button class="btn btn-primary" type="submit"><span class="label">Send challenge</span></button>
        <p class="form-error" data-form-error role="alert"></p>
      </form>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Challenges' });
}

async function clubsPage(ctx, pathname) {
  const { member } = ctx;
  const clubs = await query(
    `SELECT c.*, (SELECT count(*) FROM club_memberships m WHERE m.club_id=c.id AND m.banned=FALSE) AS n
     FROM clubs c ORDER BY c.name`);
  const visible = [];
  for (const club of clubs.rows) {
    if (club.private) {
      const m = await query('SELECT 1 FROM club_memberships WHERE club_id=$1 AND member_id=$2 AND banned=FALSE', [club.id, member.id]);
      if (m.rowCount === 0) continue;
    }
    visible.push(club);
  }
  const rows = visible.map(c => `<tr><td><a href="/clubs/${esc(c.slug)}">${esc(c.name)}</a></td><td>${c.private ? 'private' : 'public'}</td><td class="num">${Number(c.n)}</td></tr>`).join('');
  const body = `
  <div class="page">
    <h1>Clubs</h1>
    <section class="card">
      ${visible.length ? `<table class="grid"><thead><tr><th>Club</th><th>Visibility</th><th>Members</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No clubs to show yet. <a href="/members">Find members</a> and gather one.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Clubs' });
}

async function clubDetailPage(ctx, pathname) {
  const { member, club } = ctx;
  const members = await query(
    `SELECT m.username, m.rating, m.avatar_key, m.id, cm.role, cm.banned
     FROM club_memberships cm JOIN members m ON m.id = cm.member_id
     WHERE cm.club_id=$1 ORDER BY cm.role, m.username`, [club.id]);
  const roleOrder = { owner: 0, moderator: 1, member: 2 };
  members.rows.sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3) || a.username.localeCompare(b.username));
  const rows = members.rows.map(m => `<tr>
    <td><a href="/members/${esc(m.username)}">${esc(m.username)}</a></td>
    <td>${esc(m.role)}${m.banned ? ' <span style="color:var(--red)">(banned)</span>' : ''}</td>
    <td class="num">${m.rating}</td></tr>`).join('');
  const body = `
  <div class="page">
    <h1>${esc(club.name)}</h1>
    <p style="color:var(--text-75)">${club.private ? 'A private club.' : 'A public club.'} The club owner is your first port of call for any problem.</p>
    <section class="card">
      <h2 class="card-title">Members and roles</h2>
      <table class="grid"><thead><tr><th>Member</th><th>Role</th><th>Rating</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: club.name });
}

async function membersPage(ctx, pathname) {
  const { member, req } = ctx;
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  const r = await query(
    `SELECT * FROM members WHERE username <> 'The house' ${q ? 'AND username ILIKE $1' : ''} ORDER BY username ASC LIMIT 100`,
    q ? [`%${q}%`] : []);
  const rows = r.rows.map(m => `<tr>
    <td><a href="/members/${esc(m.username)}"><img class="avatar" src="${esc(avatarUrlOf(m))}" alt="" style="width:26px;height:26px;vertical-align:-8px;margin-right:8px">${esc(m.username)}</a></td>
    <td class="num">${m.rating}${m.rated_games < 10 ? '?' : ''}</td>
    <td class="num">${m.rated_games}</td></tr>`).join('');
  const body = `
  <div class="page">
    <h1>Members</h1>
    <form action="/members" method="get" class="card" style="display:flex;gap:10px;flex-wrap:wrap">
      <label for="member-search" class="sr-only">Search members</label>
      <input id="member-search" name="q" value="${esc(q)}" placeholder="Search members" style="flex:1;min-width:180px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--ground);color:var(--text)">
      <button class="btn" type="submit">Search</button>
    </form>
    <section class="card">
      ${r.rows.length ? `<table class="grid"><thead><tr><th>Member</th><th>Rating</th><th>Rated games</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No member by that name yet.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Members' });
}

async function memberDetailPage(ctx, pathname) {
  const { member, target } = ctx;
  const games = await query(
    `SELECT * FROM games WHERE (white_id=$1 OR black_id=$1) AND status='finished' AND white_id <> black_id
     ORDER BY last_move_at DESC LIMIT 50`, [target.id]);
  const tally = { w: 0, l: 0, d: 0, wW: 0, wB: 0, lW: 0, lB: 0, dW: 0, dB: 0 };
  const withOpp = [];
  for (const g of games.rows) {
    const asWhite = g.white_id === target.id;
    const res = g.result;
    const win = (res === '1-0' && asWhite) || (res === '0-1' && !asWhite);
    const draw = res === '1/2-1/2';
    if (win) { tally.w++; if (asWhite) tally.wW++; else tally.wB++; }
    else if (draw) { tally.d++; if (asWhite) tally.dW++; else tally.dB++; }
    else { tally.l++; if (asWhite) tally.lW++; else tally.lB++; }
    const oppId = asWhite ? g.black_id : g.white_id;
    const opp = (await query('SELECT username FROM members WHERE id=$1', [oppId])).rows[0];
    withOpp.push({ g, opp: opp ? opp.username : '—', colour: asWhite ? 'White' : 'Black' });
  }
  const gameRows = withOpp.map(({ g, opp, colour }) => `<tr>
    <td><a href="/game/${esc(g.id)}/record">${esc(opp)}</a></td>
    <td>${colour}</td>
    <td class="mono">${esc(g.result)}</td>
    <td>${esc(g.end_reason || '')}</td>
    <td>${g.rated ? 'rated' : 'unrated'}</td>
  </tr>`).join('');
  const isSelf = member.id === target.id;
  const body = `
  <div class="page">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <img class="avatar avatar-lg" src="${esc(avatarUrlOf(target))}" alt="" style="width:56px;height:56px">
      <div>
        <h1 style="margin:0">${esc(target.username)}</h1>
        <p style="margin:2px 0 0;color:var(--text-75)">${target.rating}${target.rated_games < 10 ? '?' : ''} · ${target.rated_games} rated games${target.role === 'administrator' ? ' · administrator' : ''}</p>
      </div>
      ${isSelf ? '' : `<button class="btn btn-sm" data-challenge-user="${esc(target.username)}" style="margin-left:auto">Challenge</button>`}
    </div>
    <section class="card">
      <h2 class="card-title">Results by colour</h2>
      <table class="grid"><thead><tr><th></th><th>As White</th><th>As Black</th><th>Total</th></tr></thead><tbody>
        <tr><th>Wins</th><td class="num">${tally.wW}</td><td class="num">${tally.wB}</td><td class="num">${tally.w}</td></tr>
        <tr><th>Losses</th><td class="num">${tally.lW}</td><td class="num">${tally.lB}</td><td class="num">${tally.l}</td></tr>
        <tr><th>Draws</th><td class="num">${tally.dW}</td><td class="num">${tally.dB}</td><td class="num">${tally.d}</td></tr>
      </tbody></table>
    </section>
    <section class="card">
      <h2 class="card-title">Finished games</h2>
      ${games.rows.length ? `<table class="grid"><thead><tr><th>Opponent</th><th>Colour</th><th>Result</th><th>Reason</th><th></th></tr></thead><tbody>${gameRows}</tbody></table>` : `<div class="empty">No finished games yet.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: target.username });
}

async function leaderboardPage(ctx, pathname) {
  const { member } = ctx;
  const r = await query(
    `SELECT * FROM members WHERE username <> 'The house' ORDER BY rating DESC, rated_games DESC, username ASC LIMIT 50`);
  const rows = r.rows.map((m, i) => `<tr${m.id === member.id ? ' style="color:var(--green)"' : ''}>
    <td class="num">${i + 1}</td>
    <td><a href="/members/${esc(m.username)}">${esc(m.username)}</a></td>
    <td class="num">${m.rating}${m.rated_games < 10 ? '?' : ''}</td>
    <td class="num">${m.rated_games}</td></tr>`).join('');
  const body = `
  <div class="page">
    <h1>Leaderboard</h1>
    <section class="card">
      <table class="grid"><thead><tr><th>Rank</th><th>Member</th><th>Rating</th><th>Games</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Leaderboard' });
}

async function notificationsPage(ctx, pathname) {
  const { member } = ctx;
  const rows = await query('SELECT * FROM notifications WHERE member_id=$1 ORDER BY id DESC LIMIT 100', [member.id]);
  const items = rows.rows.map(n => {
    const label = n.kind === 'challenge' ? 'a challenge' : n.kind === 'move' ? 'a move' : n.kind === 'chat' ? 'a chat message' : n.kind;
    const link = n.game_id ? `<a href="/game/${esc(n.game_id)}">Open the game</a>` : '<a href="/challenges">Open challenges</a>';
    return `<tr data-notification="${n.id}">
      <td>${n.read ? '<span style="color:var(--text-50)">read</span>' : '<span style="color:var(--green)">new</span>'}</td>
      <td>${esc(label)}</td>
      <td>${link}</td>
      <td>${n.read ? '' : `<button class="btn btn-sm" data-read="${n.id}">Mark read</button>`}</td>
    </tr>`;
  }).join('');
  const body = `
  <div class="page">
    <h1>Notifications</h1>
    <section class="card">
      ${rows.rows.length ? `<table class="grid"><thead><tr><th>Status</th><th>What</th><th></th><th></th></tr></thead><tbody>${items}</tbody></table>` : `<div class="empty">Nothing new.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Notifications' });
}

function settingsPage(ctx, pathname) {
  const { member } = ctx;
  const avatarRadios = Array.from({ length: 12 }, (_, i) => {
    const key = `avatar_${String(i + 1).padStart(2, '0')}`;
    return `<label style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;padding:6px;cursor:pointer">
      <input type="radio" name="avatar" value="${key}" ${member.avatar_key === key ? 'checked' : ''} style="width:auto;min-height:0">
      <img class="avatar" src="/media/avatars/${key}.svg" alt="Avatar ${i + 1} of 12" style="width:44px;height:44px">
    </label>`;
  }).join('');
  const opt = (vals, cur) => vals.map(v => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const body = `
  <div class="page" style="max-width:640px">
    <h1>Settings</h1>
    <section class="card">
      <h2 class="card-title">Your name</h2>
      <form data-form="rename" novalidate>
        <div class="field">
          <label for="set-username">Username</label>
          <input id="set-username" name="username" value="${esc(member.username)}" required>
          <div class="error" data-error-for="set-username" role="alert"></div>
        </div>
        <button class="btn" type="submit">Save name</button>
      </form>
    </section>
    <section class="card">
      <h2 class="card-title">Picture</h2>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px" role="radiogroup" aria-label="Picture">${avatarRadios}</div>
      <form data-form="avatar-upload" novalidate style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label for="avatar-file" style="font-weight:600">Or upload a picture</label>
        <input id="avatar-file" type="file" name="file" accept="image/png,image/jpeg,image/webp" style="flex:1;min-width:170px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--ground);color:var(--text)">
        <button class="btn" type="submit">Upload</button>
        <p class="form-error" data-form-error role="alert" style="flex-basis:100%"></p>
      </form>
      <p style="color:var(--text-75);font-size:13px">PNG, JPEG or WebP up to 2 MB, stored and served as a 256 by 256 PNG.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Board</h2>
      <div class="field"><label for="set-view">View</label>
        <select id="set-view" data-pref="view">${opt(['flat', 'deep', 'squares'], member.view)}</select>
      </div>
      <div class="field"><label for="set-2d">Piece set</label>
        <select id="set-2d" data-pref="piece_set_2d">${opt(['Classic', 'Staunton Flat', 'Neo', 'Pixel'], member.piece_set_2d)}</select>
      </div>
      <div class="field"><label for="set-3d">Deep piece set</label>
        <select id="set-3d" data-pref="piece_set_3d">${opt(['Marble', 'Wood', 'Glass'], member.piece_set_3d)}</select>
      </div>
      <div class="field"><label for="set-theme">Board theme</label>
        <select id="set-theme" data-pref="theme">${opt(['Walnut', 'Slate', 'Ocean', 'Forest', 'Neon'], member.theme)}</select>
      </div>
      <div class="field"><label for="set-sound">Sound</label>
        <select id="set-sound" data-pref="sound">
          <option value="true" ${member.sound ? 'selected' : ''}>On</option>
          <option value="false" ${!member.sound ? 'selected' : ''}>Off</option>
        </select>
      </div>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Settings' });
}

async function adminGamesPage(ctx, pathname) {
  const { member } = ctx;
  const games = await query(
    `SELECT g.*, w.username AS wname, b.username AS bname FROM games g
     JOIN members w ON w.id = g.white_id JOIN members b ON b.id = g.black_id
     WHERE g.status='finished' AND g.rated=TRUE AND g.white_id <> g.black_id
     ORDER BY g.last_move_at DESC LIMIT 100`);
  const rows = games.rows.map(g => `<tr>
    <td>${esc(g.wname)} vs ${esc(g.bname)}</td>
    <td class="mono">${esc(g.result)}</td>
    <td>${esc(g.end_reason || '')}</td>
    <td><a class="btn btn-sm btn-danger" data-void="${esc(g.id)}" href="/game/${esc(g.id)}/record">Void</a></td>
  </tr>`).join('');
  const body = `
  <div class="page">
    <h1>Void a rated game</h1>
    <p style="color:var(--text-75)">Voiding a game recomputes every later rated game of both players, in the order they finished, and writes an audit entry.</p>
    <section class="card">
      ${games.rows.length ? `<table class="grid"><thead><tr><th>Game</th><th>Result</th><th>Reason</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No finished rated games.</div>`}
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Admin games' });
}

// ---- the game screen

async function gamePage(ctx, pathname) {
  const { member, game, moves, white, black } = ctx;
  const pos = parseFen(game.fen);
  const isPlayer = game.white_id === member.id || game.black_id === member.id;
  const solo = game.white_id === game.black_id;
  const viewerIsWhite = game.white_id === member.id;
  const whiteS = sideShape(white);
  const blackS = sideShape(black);
  const opponent = viewerIsWhite ? blackS : whiteS;
  const me = viewerIsWhite ? whiteS : blackS;
  const meColour = viewerIsWhite ? 'white' : 'black';
  const flat = renderFlatBoard(game.fen, member.piece_set_2d);
  const kbd = renderKbdBoard(game.fen);
  const moveRows = [];
  for (let i = 0; i < moves.length; i += 2) {
    const no = Math.floor(i / 2) + 1;
    moveRows.push(`<div class="row"><span class="no">${no}.</span><span>${esc(moves[i]?.san || '')}</span><span>${esc(moves[i + 1]?.san || '')}</span></div>`);
  }
  const chatAllowed = isPlayer;
  const myTurn = (pos.turn === 'w') === viewerIsWhite;
  const body = `
  <div class="page" style="max-width:1120px">
    <div class="game-layout theme-${esc(member.theme)}" data-game-id="${esc(game.id)}"
         data-viewer="${esc(member.username)}" data-viewer-colour="${meColour}"
         data-piece-set="${esc(member.piece_set_2d)}" data-deep-set="${esc(member.piece_set_3d)}"
         data-sound="${member.sound ? 'on' : 'off'}" data-is-player="${isPlayer}">
      <div class="board-side">
        ${playerStrip(opponent, { turn: !myTurn })}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0">
          <div class="view-switch" role="group" aria-label="Board view">
            <button type="button" data-view="flat" aria-pressed="${member.view === 'flat' ? 'true' : 'false'}">${icon('grid', 'Flat board')}<span>Flat board</span></button>
            <button type="button" data-view="deep" aria-pressed="${member.view === 'deep' ? 'true' : 'false'}">${icon('cube', 'Deep board')}<span>Deep board</span></button>
            <button type="button" data-view="squares" aria-pressed="${member.view === 'squares' ? 'true' : 'false'}">${icon('keyboard', 'Square list')}<span>Square list</span></button>
          </div>
          <span class="chip">${esc(game.rated ? 'rated' : 'unrated')}${game.opening ? ` · ${esc(game.opening)}` : ''}</span>
        </div>
        <div class="board-frame" data-board-frame id="board" tabindex="-1">
          <div data-view-flat>${flat}</div>
          <div data-view-deep hidden><canvas data-deep-canvas aria-label="Deep board view, drawn in three dimensions" role="img"></canvas></div>
          <div data-view-squares hidden>
            <div class="squares-view" style="position:absolute;inset:0;overflow:auto;padding:10px">
              <table><thead><tr><th>Square</th><th>Occupant</th></tr></thead><tbody data-squares-table></tbody></table>
            </div>
          </div>
        </div>
        ${kbd}
        <div style="margin-top:10px">
          ${playerStrip(me, { turn: myTurn })}
        </div>
      </div>
      <div class="side-col">
        <section class="card frosted">
          <h2 class="card-title">Moves</h2>
          <div class="move-list" data-move-list>${moveRows.join('') || '<div class="empty">No moves yet.</div>'}</div>
          <p style="margin:8px 0 0;font-size:13px;color:var(--text-75)" data-turn-note>${esc((pos.turn === 'w' ? whiteS.username : blackS.username))} to move</p>
        </section>
        <section class="card" data-chat-card>
          <h2 class="card-title">Chat</h2>
          <div class="chat-log" data-chat-log aria-live="polite"></div>
          ${chatAllowed ? `
          <form class="chat-form" data-form="chat" novalidate>
            <label for="chat-msg" class="sr-only">Message</label>
            <input id="chat-msg" name="text" maxlength="500" placeholder="Message">
            <button class="btn btn-sm" type="submit">Send</button>
          </form>` : `<p style="color:var(--text-50);font-size:13px">You are watching this game; the chat is for the two players.</p>`}
        </section>
        ${isPlayer && !solo ? `
        <section class="card">
          <h2 class="card-title">Game controls</h2>
          <div class="controls">
            <button class="btn btn-sm" data-control="draw-offer">${icon('equals', 'Offer draw')}<span>Offer draw</span></button>
            <button class="btn btn-sm" data-control="claim-threefold">Claim draw</button>
            <button class="btn btn-sm" data-control="takeback">${icon('takeback', 'Ask for takeback')}<span>Ask for takeback</span></button>
            <button class="btn btn-sm btn-danger" data-control="resign">${icon('flag', 'Resign')}<span>Resign</span></button>
            <button class="btn btn-sm" data-control="rematch">Rematch</button>
          </div>
          <div data-offer-banner style="margin-top:10px"></div>
        </section>` : ''}
      </div>
    </div>
  </div>`;
  return shell(pathname, member, body, { title: 'Game' });
}

async function recordPage(ctx, pathname) {
  const { member, game, moves, white, black } = ctx;
  const { buildRecord } = await import('../lib/record.mjs');
  const whiteS = sideShape(white);
  const blackS = sideShape(black);
  const record = buildRecord(game, moves, whiteS.username, blackS.username);
  const body = `
  <div class="page" style="max-width:720px">
    <h1>Game record</h1>
    <p style="color:var(--text-75)"><a href="/game/${esc(game.id)}">Back to the board</a></p>
    <section class="card">
      <h2 class="card-title">The record</h2>
      <pre class="record-pre" data-record-text>${esc(record)}</pre>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" data-action="download-record"><span class="label">Download record</span></button>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Import record</h2>
      <form data-form="import-record" novalidate>
        <div class="field">
          <label for="record-input">Paste a text record</label>
          <textarea id="record-input" name="record" rows="6" style="width:100%;font-family:var(--mono);font-size:13px;background:var(--ground);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px"></textarea>
          <div class="error" data-error-for="record-input" role="alert"></div>
        </div>
        <button class="btn" type="submit">Import record</button>
      </form>
    </section>
  </div>`;
  return shell(pathname, member, body, { title: 'Game record' });
}

function notFoundPage(ctx, pathname) {
  const { member } = ctx;
  const inner = `
  <div class="page" style="max-width:520px;text-align:center;padding-top:6vh">
    <div style="font-family:var(--serif);font-size:3rem;color:var(--text-50)">♔</div>
    <h1>That game is not here.</h1>
    <p style="color:var(--text-75)">Whatever you were looking for, it is not at this address.</p>
    <p><a class="btn btn-primary" href="/hall"><span class="label">Back to the hall</span></a></p>
  </div>`;
  if (!member) return publicShell(inner, { title: 'Not here' });
  return shell(pathname, member, inner, { title: 'Not here' });
}
