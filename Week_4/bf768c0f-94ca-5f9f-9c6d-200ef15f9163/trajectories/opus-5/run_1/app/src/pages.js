/**
 * Every rendered route: three public pages, twelve member pages and one
 * administrator page.  Each one carries its content in the first response.
 */

import express from 'express';
import { pool, query, one, rows } from './db.js';
import { config } from './config.js';
import { route, fail } from './http.js';
import { layout, escapeHtml, escapeAttr, icon, emptyState } from './views/layout.js';
import {
  renderBoardStage, renderViewSwitch, renderMoveList, renderPlayerBar, renderResultScreen,
  renderChatPanel, renderGameControls, renderOfferPanel, renderPromotionDialog,
} from './views/board.js';
import { renderSquares } from './views/board.js';
import {
  fetchGame, canSee, isPlayer, sideOf, gameObject, settleDeadlines, NOT_HERE,
} from './games.js';
import { START_FEN } from './chess.js';
import { avatarUrl, AVATAR_KEYS, PIECE_SETS_2D, PIECE_SETS_3D, THEMES, VIEWS } from './members.js';
import { ratingDisplay } from './ratings.js';
import { challengesFor, clubsVisibleTo, clubDetail, directory, recordByColour, finishedGames, ladder, notificationsFor, blocksFor } from './api/social.js';
import { recordFor } from './api/games.js';
import { voidableGames, auditEntries } from './api/admin.js';
import { decodeCursor, pageLimit } from './security.js';

export const pages = express.Router();

function requirePage(req, res) {
  if (!req.member) {
    const next = encodeURIComponent(req.originalUrl);
    res.redirect(302, `/login?next=${next}`);
    return null;
  }
  return req.member;
}

async function unreadFor(memberId) {
  const row = await one(
    'select count(*)::int as unread from notifications where member_id = $1 and read = false',
    [memberId],
  );
  return row.unread;
}

export function notFoundPage(member) {
  const body = `<div class="not-here">
    <h1 class="screen-heading">That game is not here.</h1>
    <p class="lede">The address you asked for holds nothing, or it holds a game this account may not see.</p>
    <div class="not-here-actions">
      <a class="button button-primary" href="${member ? '/hall' : '/'}">Back to ${member ? 'the hall' : 'the welcome'}</a>
      ${member ? '<a class="button button-quiet" href="/play">Play a game</a>' : '<a class="button button-quiet" href="/login">Sign in</a>'}
    </div>
  </div>`;
  return layout({ member, title: 'Not here', body, bodyClass: 'page-not-here' });
}

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

pages.get('/', route(async (req, res) => {
  const body = `<div class="welcome">
    <section class="welcome-hero">
      <h1 class="screen-heading">A quiet room, one board, no clock.</h1>
      <p class="lede">Gambit Hall Club is a turn-based chess club. You play a move, your opponent answers
        whenever they next open the game. Nothing counts down, nothing is sold, nothing is tracked.</p>
      <div class="welcome-actions">
        <a class="button button-primary button-large" href="/join">Join the hall</a>
        <a class="button button-quiet button-large" href="/login">Sign in</a>
      </div>
      <ul class="welcome-points">
        <li>${icon('grid')}<span>One position, three views: a flat board, a board with depth, and sixty-four named squares you can play from the keyboard alone.</span></li>
        <li>${icon('ladder')}<span>Rated games against members, or the house opponent at three levels for no rating.</span></li>
        <li>${icon('chat')}<span>Chat beside your own board, clubs with three roles, and a record of every game you can export and import.</span></li>
      </ul>
    </section>
    <section class="welcome-board" aria-label="A board, set up">
      <div class="board-stage" data-view="flat" data-static="1">
        <div class="board-frame">
          <div class="board-grid" role="grid" aria-label="Chess board, sixty-four squares">
            ${renderSquares(START_FEN, { set2d: 'Classic' })}
          </div>
        </div>
      </div>
      <p class="board-caption">The starting position, in the <strong>Forest</strong> theme with the <strong>Classic</strong> set.</p>
    </section>
  </div>`;
  res.send(layout({ title: 'Welcome', body, bodyClass: 'page-welcome' }));
}));

pages.get('/login', route(async (req, res) => {
  if (req.member) return res.redirect(302, '/hall');
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  const body = `<div class="auth-pane">
    <h1 class="screen-heading">Sign in</h1>
    <p class="lede">Your username or your email address, whichever you remember.</p>
    <form class="form" id="login-form" novalidate data-next="${escapeAttr(next)}">
      <div class="field">
        <label for="login-username">Username</label>
        <input id="login-username" name="username" type="text" autocomplete="username" required
          aria-describedby="login-username-hint">
        <p class="field-hint" id="login-username-hint">Your username, or the email you joined with.</p>
        <p class="field-error" id="login-username-error" role="alert"></p>
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <p class="field-error" id="login-password-error" role="alert"></p>
      </div>
      <p class="form-error" id="login-error" role="alert"></p>
      <button type="submit" class="button button-primary button-large">Sign in</button>
    </form>
    <p class="auth-switch">New here? <a href="/join">Join the hall</a>.</p>
  </div>`;
  res.send(layout({ title: 'Sign in', body, bodyClass: 'page-auth', scripts: ['/js/auth.js'] }));
}));

pages.get('/join', route(async (req, res) => {
  if (req.member) return res.redirect(302, '/hall');
  const body = `<div class="auth-pane">
    <h1 class="screen-heading">Join the hall</h1>
    <p class="lede">Pick a name and play. There is nothing to pay and nothing to confirm.</p>
    <form class="form" id="join-form" novalidate>
      <div class="field">
        <label for="join-username">Username</label>
        <input id="join-username" name="username" type="text" autocomplete="username" required
          minlength="3" maxlength="20" aria-describedby="join-username-hint">
        <p class="field-hint" id="join-username-hint">3 to 20 letters, digits and underscores.</p>
        <p class="field-error" id="join-username-error" role="alert"></p>
      </div>
      <div class="field">
        <label for="join-email">Email</label>
        <input id="join-email" name="email" type="email" autocomplete="email" required>
        <p class="field-error" id="join-email-error" role="alert"></p>
      </div>
      <div class="field">
        <label for="join-password">Password</label>
        <input id="join-password" name="password" type="password" autocomplete="new-password" required minlength="8"
          aria-describedby="join-password-hint">
        <p class="field-hint" id="join-password-hint">At least 8 characters.</p>
        <p class="field-error" id="join-password-error" role="alert"></p>
      </div>
      <p class="form-error" id="join-error" role="alert"></p>
      <button type="submit" class="button button-primary button-large">Join the hall</button>
    </form>
    <p class="auth-switch">Already a member? <a href="/login">Sign in</a>.</p>
  </div>`;
  res.send(layout({ title: 'Join', body, bodyClass: 'page-auth', scripts: ['/js/auth.js'] }));
}));

// ---------------------------------------------------------------------------
// The hall
// ---------------------------------------------------------------------------

function gameCardRow(game, member) {
  const opponent = game.white_id === member.id
    ? (game.black_username || 'The house')
    : (game.white_username || 'The house');
  const yourTurn = game.turn_side === (game.white_id === member.id ? 'white' : 'black');
  return `<li class="game-card">
    <a class="game-card-link" href="/game/${escapeAttr(game.id)}">
      <span class="game-card-main">
        <strong>${escapeHtml(opponent)}</strong>
        <span class="game-card-meta">${game.rated ? 'Rated' : 'Unrated'}${game.level ? ` · the house at ${escapeHtml(game.level)}` : ''}${game.club_name ? ` · ${escapeHtml(game.club_name)}` : ''}</span>
      </span>
      <span class="game-card-turn ${yourTurn ? 'is-yours' : ''}">${yourTurn ? 'Your move' : 'Their move'}</span>
    </a>
  </li>`;
}

async function gamesInProgress(memberId) {
  return rows(
    `select g.*, w.username as white_username, b.username as black_username, c.name as club_name,
            case when split_part(g.fen, ' ', 2) = 'w' then 'white' else 'black' end as turn_side
       from games g
       left join members w on w.id = g.white_id
       left join members b on b.id = g.black_id
       left join clubs c on c.id = g.club_id
      where g.status = 'in_progress' and (g.white_id = $1 or g.black_id = $1)
      order by g.last_move_at desc`,
    [memberId],
  );
}

pages.get('/hall', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const [games, challenges, unread] = await Promise.all([
    gamesInProgress(member.id),
    challengesFor(member.id),
    unreadFor(member.id),
  ]);
  const received = challenges.filter((c) => c.direction === 'received');

  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Good to see you, ${escapeHtml(member.username)}.</h1>
      <p class="lede">Your games wait for you. Nothing here is on a clock.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Games in progress</h2>
      ${games.length
        ? `<ul class="game-cards">${games.map((game) => gameCardRow(game, member)).join('')}</ul>`
        : emptyState('No games in progress.', '<a href="/play">Play a game</a> to start one.')}
    </section>
    <section class="panel">
      <h2 class="panel-heading">Challenges received</h2>
      ${received.length
        ? `<ul class="challenge-list">${received.map((c) => `<li class="challenge-row">
            <span><strong>${escapeHtml(c.opponent)}</strong> · ${c.rated ? 'rated' : 'unrated'} · you play ${escapeHtml(c.colour === 'White' ? 'Black' : c.colour === 'Black' ? 'White' : 'either colour')}</span>
            <a class="button button-quiet" href="/challenges">Answer on the challenges page</a>
          </li>`).join('')}</ul>`
        : emptyState('No challenges yet.', '<a href="/members">Find a member</a> to challenge.')}
    </section>
    <section class="panel">
      <h2 class="panel-heading">Where to go</h2>
      <div class="link-grid">
        <a class="link-card" href="/play">${icon('play', { filled: true })}<span>Play</span></a>
        <a class="link-card" href="/leaderboard">${icon('ladder')}<span>Leaderboard</span></a>
        <a class="link-card" href="/clubs">${icon('shield')}<span>Clubs</span></a>
        <a class="link-card" href="/settings">${icon('gear')}<span>Settings</span></a>
      </div>
    </section>
  </div>`;
  res.send(layout({ member, title: 'The hall', body, active: '/hall', unread, scripts: [] }));
}));

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

pages.get('/play', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const [clubs, unread] = await Promise.all([clubsVisibleTo(member.id), unreadFor(member.id)]);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Choose a play mode</h1>
      <p class="lede">A rated game against a member, or the house for no rating.</p>
    </header>
    <div class="play-grid">
      <section class="panel">
        <h2 class="panel-heading">Play a member</h2>
        <form class="form" id="challenge-form" novalidate>
          <div class="field">
            <label for="challenge-opponent">Opponent</label>
            <input id="challenge-opponent" name="opponent" type="text" list="member-names" autocomplete="off" required>
            <p class="field-error" id="challenge-opponent-error" role="alert"></p>
          </div>
          <fieldset class="field">
            <legend>Colour</legend>
            <div class="radio-row">
              <label class="radio"><input type="radio" name="colour" value="White" checked><span>White</span></label>
              <label class="radio"><input type="radio" name="colour" value="Black"><span>Black</span></label>
              <label class="radio"><input type="radio" name="colour" value="Random"><span>Random</span></label>
            </div>
          </fieldset>
          <div class="field">
            <label for="challenge-club">Club (optional)</label>
            <select id="challenge-club" name="club">
              <option value="">No club</option>
              ${clubs.filter((c) => !c.banned).map((c) => `<option value="${escapeAttr(c.slug)}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <label class="checkbox"><input type="checkbox" name="rated" checked><span>Rated</span></label>
          <p class="form-error" id="challenge-error" role="alert"></p>
          <button type="submit" class="button button-primary">Send challenge</button>
          <p class="form-note" id="challenge-note" role="status"></p>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-heading">Play the house</h2>
        <p class="panel-note">The house never moves a rating. It answers the same position the same way every time.</p>
        <form class="form" id="house-form">
          <fieldset class="field">
            <legend>Level</legend>
            <div class="radio-row">
              <label class="radio"><input type="radio" name="level" value="easy"><span>Easy</span></label>
              <label class="radio"><input type="radio" name="level" value="steady" checked><span>Steady</span></label>
              <label class="radio"><input type="radio" name="level" value="sharp"><span>Sharp</span></label>
            </div>
          </fieldset>
          <fieldset class="field">
            <legend>Your colour</legend>
            <div class="radio-row">
              <label class="radio"><input type="radio" name="colour" value="white" checked><span>White</span></label>
              <label class="radio"><input type="radio" name="colour" value="black"><span>Black</span></label>
            </div>
          </fieldset>
          <p class="form-error" id="house-error" role="alert"></p>
          <button type="submit" class="button button-primary">Play the house</button>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-heading">Work through a position</h2>
        <p class="panel-note">Set a position up by its record and play it out, either side, or against the house.</p>
        <form class="form" id="study-form">
          <div class="field">
            <label for="study-fen">Position record</label>
            <input id="study-fen" name="fen" type="text" class="mono" value="${escapeAttr(START_FEN)}" required>
            <p class="field-error" id="study-fen-error" role="alert"></p>
          </div>
          <div class="field">
            <label for="study-level">House level (optional)</label>
            <select id="study-level" name="level">
              <option value="">No house, play both sides</option>
              <option value="easy">Easy</option>
              <option value="steady">Steady</option>
              <option value="sharp">Sharp</option>
            </select>
          </div>
          <button type="submit" class="button button-quiet">Open the position</button>
        </form>
      </section>
    </div>
    <datalist id="member-names"></datalist>
  </div>`;
  res.send(layout({ member, title: 'Play', body, active: '/play', unread, scripts: ['/js/play.js'] }));
}));

// ---------------------------------------------------------------------------
// One game, in all three views
// ---------------------------------------------------------------------------

async function chatFor(gameId) {
  return rows(
    `select c.id, c.member_id, c.text, c.created_at, m.username, m.avatar_key
       from chat_messages c join members m on m.id = c.member_id
      where c.game_id = $1 order by c.created_at asc, c.id asc limit 100`,
    [gameId],
  );
}

pages.get('/game/:game_id', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  await settleDeadlines(req.params.game_id);
  const row = await fetchGame(pool, req.params.game_id);
  if (!row || !await canSee(pool, row, member)) {
    return res.status(404).send(notFoundPage(member));
  }
  const game = await gameObject(pool, row);
  const side = sideOf(row, member.id);
  const player = isPlayer(row, member.id);
  const flip = side === 'black';
  const requested = typeof req.query.view === 'string' && VIEWS.includes(req.query.view) ? req.query.view : null;
  const view = requested || member.view;
  const unread = await unreadFor(member.id);
  const messages = player
    ? (await chatFor(row.id)).map((message) => ({
      id: message.id,
      username: message.username,
      avatar_url: avatarUrl({ id: message.member_id, avatar_key: message.avatar_key }),
      text: message.text,
      created_at: message.created_at,
    }))
    : [];

  const top = flip ? game.white : game.black;
  const bottom = flip ? game.black : game.white;
  const topSide = flip ? 'white' : 'black';
  const bottomSide = flip ? 'black' : 'white';
  const lastMove = game.moves.length ? game.moves[game.moves.length - 1] : null;

  const body = `<div class="game-screen" id="game-screen"
      data-game-id="${escapeAttr(game.id)}" data-fen="${escapeAttr(game.fen)}" data-turn="${escapeAttr(game.turn)}"
      data-side="${escapeAttr(side || 'spectator')}" data-flip="${flip ? '1' : '0'}"
      data-status="${escapeAttr(game.status)}" data-ply="${game.moves.length}"
      data-set2d="${escapeAttr(member.piece_set_2d)}" data-set3d="${escapeAttr(member.piece_set_3d)}"
      data-view="${escapeAttr(view)}" data-level="${escapeAttr(game.level || '')}"
      data-legal="${escapeAttr(game.legal_moves.join(' '))}">
    <div class="game-main">
      <div class="game-head">
        <h1 class="game-title">
          ${escapeHtml(game.white.username)} <span class="versus">versus</span> ${escapeHtml(game.black.username)}
        </h1>
        <p class="game-meta">
          <span class="chip${game.rated ? ' chip-accent' : ''}">${game.rated ? 'Rated' : 'Unrated'}</span>
          ${game.club ? `<span class="chip">${escapeHtml(game.club.name)}</span>` : ''}
          ${game.level ? `<span class="chip">The house at ${escapeHtml(game.level)}</span>` : ''}
          ${game.opening ? `<span class="chip chip-bronze">${escapeHtml(game.opening)}</span>` : ''}
          <span class="chip" id="status-chip">${game.status === 'in_progress'
            ? `${escapeHtml(game.turn === 'white' ? 'White' : 'Black')} to move`
            : `${escapeHtml(game.result)}`}</span>
        </p>
      </div>
      ${renderViewSwitch(view)}
      ${renderPlayerBar(top, { side: topSide, toMove: game.status === 'in_progress' && game.turn === topSide, className: 'player-top' })}
      ${renderBoardStage(game, { view, flip, set2d: member.piece_set_2d })}
      ${renderPlayerBar(bottom, { side: bottomSide, toMove: game.status === 'in_progress' && game.turn === bottomSide, className: 'player-bottom' })}
      <p class="move-announcement" id="move-announcement">${lastMove ? escapeHtml(lastMove.announcement) : 'No moves yet.'}</p>
      ${renderResultScreen(game, side)}
    </div>
    <aside class="game-side" aria-label="Game panels">
      <div class="side-tabs" role="tablist" aria-label="Side panels">
        <button type="button" class="side-tab is-active" role="tab" aria-selected="true" aria-controls="panel-moves" id="tab-moves">Moves</button>
        <button type="button" class="side-tab" role="tab" aria-selected="false" aria-controls="panel-chat" id="tab-chat">Chat</button>
        <button type="button" class="side-tab" role="tab" aria-selected="false" aria-controls="panel-controls" id="tab-controls">Controls</button>
      </div>
      <section class="panel side-panel is-active" id="panel-moves" role="tabpanel" aria-labelledby="tab-moves" tabindex="0">
        <h2 class="panel-heading">Moves</h2>
        <div class="move-list-frame" id="move-list-frame">${renderMoveList(game.moves)}</div>
      </section>
      <section class="panel side-panel" id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" tabindex="0">
        <h2 class="panel-heading">Chat</h2>
        ${renderChatPanel(messages, { isPlayer: player, viewer: member })}
      </section>
      <section class="panel side-panel" id="panel-controls" role="tabpanel" aria-labelledby="tab-controls" tabindex="0">
        <h2 class="panel-heading">Game</h2>
        ${renderOfferPanel(game, { isPlayer: player, viewer: member })}
        ${renderGameControls(game, { isPlayer: player })}
        <p class="claims-note" id="claims-note">
          Threefold claim: <strong data-claim-state="threefold">${game.claims.threefold ? 'available' : 'not yet'}</strong>.
          Fifty-move claim: <strong data-claim-state="fifty-move">${game.claims['fifty-move'] ? 'available' : 'not yet'}</strong>.
        </p>
        <p class="panel-note"><a href="/game/${escapeAttr(game.id)}/record">The game record</a></p>
      </section>
    </aside>
    ${renderPromotionDialog()}
    <p class="toast" id="toast" role="alert" hidden></p>
    <script type="application/json" id="game-state">${JSON.stringify(game).replace(/</g, '\\u003c')}</script>
  </div>`;

  res.send(layout({
    member, title: 'Game', body, active: null, unread,
    skipLabel: 'Skip to board', skipTarget: '#board-stage',
    bodyClass: 'page-game', scripts: ['/js/game.js'],
  }));
}));

pages.get('/game/:game_id/record', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  await settleDeadlines(req.params.game_id);
  const row = await fetchGame(pool, req.params.game_id);
  if (!row || !await canSee(pool, row, member)) {
    return res.status(404).send(notFoundPage(member));
  }
  const game = await gameObject(pool, row);
  const text = await recordFor(row);
  const unread = await unreadFor(member.id);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">The game record</h1>
      <p class="lede">${escapeHtml(game.white.username)} versus ${escapeHtml(game.black.username)},
        ${game.opening ? `the ${escapeHtml(game.opening)}` : 'no named opening'},
        ${escapeHtml(game.result)}.</p>
      <p><a href="/game/${escapeAttr(game.id)}">Back to the board</a></p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Record</h2>
      <pre class="record mono" id="record-text">${escapeHtml(text)}</pre>
      <div class="record-actions">
        <a class="button button-primary" href="/api/games/${escapeAttr(game.id)}/record?download=1" download="gambit-hall-${escapeAttr(game.id)}.pgn">${icon('download')}<span>Download record</span></a>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-heading">Import record</h2>
      <p class="panel-note">Paste a record to open it as a position you can play through. An invalid record is refused by its line.</p>
      <form class="form" id="import-form">
        <div class="field">
          <label for="import-text">Record</label>
          <textarea id="import-text" name="record" rows="8" class="mono" required></textarea>
          <p class="field-error" id="import-error" role="alert"></p>
        </div>
        <button type="submit" class="button button-quiet">${icon('upload')}<span>Import record</span></button>
      </form>
    </section>
  </div>`;
  res.send(layout({ member, title: 'Record', body, unread, scripts: ['/js/record.js'] }));
}));

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

pages.get('/challenges', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const [challenges, clubs, unread] = await Promise.all([
    challengesFor(member.id), clubsVisibleTo(member.id), unreadFor(member.id),
  ]);
  const received = challenges.filter((c) => c.direction === 'received');
  const sent = challenges.filter((c) => c.direction === 'sent');

  const receivedHtml = received.length
    ? `<ul class="challenge-list" id="received-list">${received.map((c) => `
        <li class="challenge-row" data-challenge-id="${escapeAttr(c.id)}">
          <img class="challenge-avatar" src="${escapeAttr(c.opponent_avatar_url)}" width="40" height="40" alt="">
          <span class="challenge-text">
            <strong>${escapeHtml(c.opponent)}</strong> <span class="quiet">${escapeHtml(c.opponent_rating_display)}</span>
            <span class="challenge-meta">${c.rated ? 'Rated' : 'Unrated'} · they take ${escapeHtml(c.colour)}${c.club_name ? ` · ${escapeHtml(c.club_name)}` : ''}</span>
          </span>
          <span class="challenge-actions">
            <button type="button" class="button button-primary" data-accept="${escapeAttr(c.id)}">Accept</button>
            <button type="button" class="button button-quiet" data-decline="${escapeAttr(c.id)}">Decline</button>
          </span>
        </li>`).join('')}</ul>`
    : emptyState('No challenges yet.', '<a href="/members">Find a member</a> to challenge.');

  const sentHtml = sent.length
    ? `<ul class="challenge-list" id="sent-list">${sent.map((c) => `
        <li class="challenge-row" data-challenge-id="${escapeAttr(c.id)}">
          <img class="challenge-avatar" src="${escapeAttr(c.opponent_avatar_url)}" width="40" height="40" alt="">
          <span class="challenge-text"><strong>${escapeHtml(c.opponent)}</strong>
            <span class="challenge-meta">${c.rated ? 'Rated' : 'Unrated'} · you take ${escapeHtml(c.colour)}${c.club_name ? ` · ${escapeHtml(c.club_name)}` : ''} · waiting</span>
          </span>
        </li>`).join('')}</ul>`
    : emptyState('No challenges sent.');

  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Challenges</h1>
      <p class="lede">Accepting a challenge creates the game at once.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Received</h2>
      ${receivedHtml}
    </section>
    <section class="panel">
      <h2 class="panel-heading">Sent</h2>
      ${sentHtml}
    </section>
    <section class="panel">
      <h2 class="panel-heading">Send a challenge</h2>
      <form class="form" id="challenge-form" novalidate>
        <div class="field">
          <label for="challenge-opponent">Opponent</label>
          <input id="challenge-opponent" name="opponent" type="text" autocomplete="off" required>
          <p class="field-error" id="challenge-opponent-error" role="alert"></p>
        </div>
        <fieldset class="field">
          <legend>Colour</legend>
          <div class="radio-row">
            <label class="radio"><input type="radio" name="colour" value="White" checked><span>White</span></label>
            <label class="radio"><input type="radio" name="colour" value="Black"><span>Black</span></label>
            <label class="radio"><input type="radio" name="colour" value="Random"><span>Random</span></label>
          </div>
        </fieldset>
        <div class="field">
          <label for="challenge-club">Club (optional)</label>
          <select id="challenge-club" name="club">
            <option value="">No club</option>
            ${clubs.filter((c) => !c.banned).map((c) => `<option value="${escapeAttr(c.slug)}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <label class="checkbox"><input type="checkbox" name="rated" checked><span>Rated</span></label>
        <p class="form-error" id="challenge-error" role="alert"></p>
        <button type="submit" class="button button-primary">Send challenge</button>
        <p class="form-note" id="challenge-note" role="status"></p>
      </form>
    </section>
    <p class="toast" id="toast" role="alert" hidden></p>
  </div>`;
  res.send(layout({ member, title: 'Challenges', body, active: '/challenges', unread, scripts: ['/js/challenges.js'] }));
}));

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

pages.get('/clubs', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const [clubs, unread] = await Promise.all([clubsVisibleTo(member.id), unreadFor(member.id)]);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Clubs</h1>
      <p class="lede">A club holds its own games. A private club's games are invisible outside it.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Your clubs</h2>
      ${clubs.length ? `<ul class="club-list">${clubs.map((club) => `
        <li class="club-row">
          <span class="club-mark">${icon('shield')}</span>
          <span class="club-text">
            <a class="club-name" href="/clubs/${escapeAttr(club.slug)}">${escapeHtml(club.name)}</a>
            <span class="club-meta">${club.private ? 'Private' : 'Public'} · ${club.member_count} member${club.member_count === 1 ? '' : 's'}${club.my_role ? ` · you are ${escapeHtml(club.my_role)}` : ''}${club.banned ? ' · you are banned' : ''}</span>
          </span>
        </li>`).join('')}</ul>` : emptyState('No clubs yet.', 'Ask the owner of a club to add you, or play in the open hall.')}
    </section>
  </div>`;
  res.send(layout({ member, title: 'Clubs', body, active: '/clubs', unread }));
}));

pages.get('/clubs/:club_slug', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const club = await clubDetail(member.id, req.params.club_slug);
  if (!club) return res.status(404).send(notFoundPage(member));
  const unread = await unreadFor(member.id);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">${escapeHtml(club.name)}</h1>
      <p class="lede">${club.private ? 'A private club. Its games are visible only to its members.' : 'A public club. Anyone signed in may watch its games.'}</p>
      <p><a href="/clubs">All clubs</a></p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Members and roles</h2>
      <table class="table">
        <thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Rating</th></tr></thead>
        <tbody>
          ${club.members.map((row) => `<tr>
            <td><a href="/members/${escapeAttr(row.username)}">${escapeHtml(row.username)}</a>${row.banned ? ' <span class="chip chip-warn">banned</span>' : ''}</td>
            <td>${escapeHtml(row.role)}</td>
            <td class="mono">${escapeHtml(row.rating_display)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>
  </div>`;
  res.send(layout({ member, title: club.name, body, active: '/clubs', unread }));
}));

// ---------------------------------------------------------------------------
// Members, profiles and the ladder
// ---------------------------------------------------------------------------

pages.get('/members', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';
  const [{ members }, unread] = await Promise.all([
    directory({ q, limit: 50, cursor: null }),
    unreadFor(member.id),
  ]);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Members</h1>
      <p class="lede">Search the directory and challenge anyone in it.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Search</h2>
      <form class="form form-inline" role="search" action="/members" method="get">
        <div class="field">
          <label for="member-search">Member name</label>
          <input id="member-search" name="q" type="search" value="${escapeAttr(q)}" autocomplete="off">
        </div>
        <button type="submit" class="button button-primary">Search</button>
      </form>
    </section>
    <section class="panel">
      <h2 class="panel-heading">${q ? `Results for “${escapeHtml(q)}”` : 'Everyone'}</h2>
      ${members.length ? `<ul class="member-list">${members.map((row) => `
        <li class="member-row">
          <img src="${escapeAttr(row.avatar_url)}" width="40" height="40" alt="">
          <a class="member-name" href="/members/${escapeAttr(row.username)}">${escapeHtml(row.username)}</a>
          <span class="mono quiet">${escapeHtml(row.rating_display)}</span>
          <span class="member-row-actions">
            <button type="button" class="button button-quiet" data-challenge-member="${escapeAttr(row.username)}">Challenge</button>
            <button type="button" class="button button-quiet" data-block-member="${escapeAttr(row.username)}">Block</button>
          </span>
        </li>`).join('')}</ul>` : emptyState('No member by that name.')}
    </section>
    <p class="toast" id="toast" role="alert" hidden></p>
  </div>`;
  res.send(layout({ member, title: 'Members', body, active: '/members', unread, scripts: ['/js/members.js'] }));
}));

const REASON_LABEL = {
  checkmate: 'checkmate', resignation: 'resignation', agreement: 'agreement',
  'threefold claim': 'threefold claim', 'fifty-move claim': 'fifty-move claim',
  'fivefold repetition': 'fivefold repetition', 'insufficient material': 'insufficient material',
  stalemate: 'stalemate', deadline: 'deadline', void: 'void',
};

pages.get('/members/:username', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const target = await one('select * from members where lower(username) = lower($1)', [req.params.username]);
  if (!target) return res.status(404).send(notFoundPage(member));
  const [record, games, unread] = await Promise.all([
    recordByColour(target.id),
    finishedGames(target.id, { limit: 25, cursor: null }),
    unreadFor(member.id),
  ]);
  const body = `<div class="stack">
    <header class="page-head member-head">
      <img class="member-portrait" src="${escapeAttr(avatarUrl(target))}" width="96" height="96" alt="">
      <div>
        <h1 class="screen-heading">${escapeHtml(target.username)}</h1>
        <p class="lede">Rating <strong class="mono">${escapeHtml(ratingDisplay(target.rating, target.rated_games))}</strong>
          over ${target.rated_games} rated game${target.rated_games === 1 ? '' : 's'}${target.role === 'administrator' ? ' · administrator' : ''}.</p>
        ${target.id === member.id ? '<p><a href="/settings">Change your name, picture and preferences</a></p>' : `<p><button type="button" class="button button-quiet" data-challenge-member="${escapeAttr(target.username)}">Challenge ${escapeHtml(target.username)}</button></p>`}
      </div>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Record by colour</h2>
      <table class="table">
        <thead><tr><th scope="col">Colour</th><th scope="col">Wins</th><th scope="col">Losses</th><th scope="col">Draws</th></tr></thead>
        <tbody>
          <tr><th scope="row">White</th><td class="mono">${record.wins.white}</td><td class="mono">${record.losses.white}</td><td class="mono">${record.draws.white}</td></tr>
          <tr><th scope="row">Black</th><td class="mono">${record.wins.black}</td><td class="mono">${record.losses.black}</td><td class="mono">${record.draws.black}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="panel">
      <h2 class="panel-heading">Finished games</h2>
      ${games.games.length ? `<table class="table">
        <thead><tr><th scope="col">Opponent</th><th scope="col">Colour</th><th scope="col">Result</th><th scope="col">Reason</th><th scope="col">Record</th></tr></thead>
        <tbody>
          ${games.games.map((game) => `<tr>
            <td>${escapeHtml(game.opponent)}</td>
            <td>${escapeHtml(game.colour)}</td>
            <td class="mono">${escapeHtml(game.result)}</td>
            <td>${escapeHtml(REASON_LABEL[game.reason] || game.reason || '')}</td>
            <td><a href="/game/${escapeAttr(game.game_id)}/record">Record</a></td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="empty-state">No finished games yet.</p>'}
    </section>
    <p class="toast" id="toast" role="alert" hidden></p>
  </div>`;
  res.send(layout({ member, title: target.username, body, active: '/members', unread, scripts: ['/js/members.js'] }));
}));

pages.get('/leaderboard', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const limit = pageLimit(req.query.limit, 50, 100);
  let cursor = null;
  try {
    cursor = decodeCursor(req.query.cursor);
  } catch {
    return res.status(400).send(notFoundPage(member));
  }
  const [page, unread] = await Promise.all([ladder({ limit, cursor }), unreadFor(member.id)]);
  const offset = 0;
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Leaderboard</h1>
      <p class="lede">By rating, then by games played, then by name.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">The ladder</h2>
      <table class="table">
        <thead><tr><th scope="col">Rank</th><th scope="col">Member</th><th scope="col">Rating</th><th scope="col">Games</th></tr></thead>
        <tbody>
          ${page.members.map((row, index) => `<tr${row.username === member.username ? ' class="is-me"' : ''}>
            <td class="mono">${offset + index + 1}</td>
            <td><img class="row-avatar" src="${escapeAttr(row.avatar_url)}" width="28" height="28" alt=""> <a href="/members/${escapeAttr(row.username)}">${escapeHtml(row.username)}</a></td>
            <td class="mono">${escapeHtml(row.rating_display)}</td>
            <td class="mono">${row.rated_games}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${page.next_cursor ? `<p class="pager"><a class="button button-quiet" href="/leaderboard?cursor=${encodeURIComponent(page.next_cursor)}">Next page</a></p>` : '<p class="pager quiet">That is the whole ladder.</p>'}
    </section>
  </div>`;
  res.send(layout({ member, title: 'Leaderboard', body, active: '/leaderboard', unread }));
}));

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

pages.get('/notifications', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const { notifications, unread } = await notificationsFor(member.id);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Notifications</h1>
      <p class="lede"><span id="unread-count" data-unread="${unread}">${unread}</span> unread.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Everything new</h2>
      ${notifications.length ? `<ul class="notification-list" id="notification-list">${notifications.map((note) => `
        <li class="notification-row${note.read ? '' : ' is-unread'}" data-notification-id="${escapeAttr(note.id)}">
          <span class="notification-mark">${icon(note.kind === 'challenge' ? 'challenge' : note.kind === 'chat' ? 'chat' : 'pawn', { filled: note.kind === 'move' })}</span>
          <span class="notification-text">${escapeHtml(note.text)}
            ${note.game_id ? `<a class="notification-link" href="/game/${escapeAttr(note.game_id)}">Open the game</a>` : '<a class="notification-link" href="/challenges">Open challenges</a>'}
          </span>
          ${note.read ? '<span class="chip">read</span>' : '<button type="button" class="button button-quiet" data-mark-read="' + escapeAttr(note.id) + '">Mark read</button>'}
        </li>`).join('')}</ul>` : '<p class="empty-state">Nothing new.</p>'}
    </section>
  </div>`;
  res.send(layout({ member, title: 'Notifications', body, active: '/notifications', unread, scripts: ['/js/notifications.js'] }));
}));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

pages.get('/settings', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  const [unread, blocked] = await Promise.all([unreadFor(member.id), blocksFor(member.id)]);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Settings</h1>
      <p class="lede">Your name, your picture and how the board looks. Every choice follows your account.</p>
    </header>

    <section class="panel">
      <h2 class="panel-heading">Name</h2>
      <form class="form form-inline" id="name-form">
        <div class="field">
          <label for="settings-username">Username</label>
          <input id="settings-username" name="username" type="text" value="${escapeAttr(member.username)}"
            minlength="3" maxlength="20" required>
          <p class="field-error" id="settings-username-error" role="alert"></p>
        </div>
        <button type="submit" class="button button-primary">Save name</button>
      </form>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Picture</h2>
      <div class="avatar-grid" role="group" aria-label="Choose a picture">
        ${AVATAR_KEYS.map((key) => `<label class="avatar-choice">
          <input type="radio" name="avatar" value="${key}"${member.avatar_key === key ? ' checked' : ''}>
          <img src="/media/avatars/${key}.png" width="64" height="64" alt="${key.replace('_', ' ')}">
        </label>`).join('')}
      </div>
      <form class="form" id="avatar-upload-form">
        <div class="field">
          <label for="avatar-file">Or upload a picture (PNG, JPEG or WebP, up to 2 MB)</label>
          <input id="avatar-file" name="file" type="file" accept="image/png,image/jpeg,image/webp">
          <p class="field-error" id="avatar-error" role="alert"></p>
        </div>
        <button type="submit" class="button button-quiet">Upload picture</button>
      </form>
      <p class="settings-current">Now showing: <img class="avatar-now" id="avatar-now" src="${escapeAttr(avatarUrl(member))}" width="48" height="48" alt="Your picture"></p>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Board view</h2>
      <fieldset class="field">
        <legend>Which view opens first</legend>
        <div class="radio-row">
          ${VIEWS.map((value) => `<label class="radio"><input type="radio" name="view" value="${value}"${member.view === value ? ' checked' : ''}><span>${value === 'flat' ? 'Flat board' : value === 'deep' ? 'Deep board' : 'Square list'}</span></label>`).join('')}
        </div>
      </fieldset>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Piece set</h2>
      <fieldset class="field">
        <legend>Flat pieces</legend>
        <div class="radio-row">
          ${PIECE_SETS_2D.map((value) => `<label class="radio"><input type="radio" name="piece_set_2d" value="${escapeAttr(value)}"${member.piece_set_2d === value ? ' checked' : ''}><span>${escapeHtml(value)}</span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="field">
        <legend>Deep pieces</legend>
        <div class="radio-row">
          ${PIECE_SETS_3D.map((value) => `<label class="radio"><input type="radio" name="piece_set_3d" value="${escapeAttr(value)}"${member.piece_set_3d === value ? ' checked' : ''}><span>${escapeHtml(value)}</span></label>`).join('')}
        </div>
      </fieldset>
      <div class="set-preview" id="set-preview" aria-hidden="true"></div>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Board theme</h2>
      <fieldset class="field">
        <legend>Theme</legend>
        <div class="theme-row">
          ${THEMES.map((value) => `<label class="theme-choice" data-theme-preview="${escapeAttr(value)}">
            <input type="radio" name="theme" value="${escapeAttr(value)}"${member.theme === value ? ' checked' : ''}>
            <span class="theme-swatch" aria-hidden="true"><span class="sw-light"></span><span class="sw-dark"></span></span>
            <span>${escapeHtml(value)}</span>
          </label>`).join('')}
        </div>
      </fieldset>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Sound</h2>
      <fieldset class="field">
        <legend>Sound</legend>
        <div class="radio-row">
          <label class="radio"><input type="radio" name="sound" value="on"${member.sound ? ' checked' : ''}><span>On</span></label>
          <label class="radio"><input type="radio" name="sound" value="off"${member.sound ? '' : ' checked'}><span>Off</span></label>
        </div>
      </fieldset>
      <p class="panel-note">One sound each for a move, a capture, a promotion, a victory, a defeat and a draw.</p>
      <button type="button" class="button button-quiet" id="sound-test">Hear the move sound</button>
    </section>

    <section class="panel">
      <h2 class="panel-heading">Blocked members</h2>
      ${blocked.length ? `<ul class="member-list">${blocked.map((row) => `<li class="member-row">
        <img src="${escapeAttr(avatarUrl(row))}" width="32" height="32" alt="">
        <span class="member-name">${escapeHtml(row.username)}</span>
        <button type="button" class="button button-quiet" data-unblock="${escapeAttr(row.username)}">Unblock</button>
      </li>`).join('')}</ul>` : '<p class="empty-state">You have blocked nobody.</p>'}
    </section>

    <p class="form-note" id="settings-note" role="status"></p>
    <p class="toast" id="toast" role="alert" hidden></p>
  </div>`;
  res.send(layout({ member, title: 'Settings', body, active: null, unread, scripts: ['/js/settings.js'] }));
}));

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

pages.get('/admin/games', route(async (req, res) => {
  const member = requirePage(req, res);
  if (!member) return;
  if (member.role !== 'administrator') return res.status(404).send(notFoundPage(member));
  const [games, audits, unread] = await Promise.all([voidableGames(60), auditEntries(40), unreadFor(member.id)]);
  const body = `<div class="stack">
    <header class="page-head">
      <h1 class="screen-heading">Void a rated game</h1>
      <p class="lede">Voiding undoes a rated result and recomputes every later rated game of both players, in order.</p>
    </header>
    <section class="panel">
      <h2 class="panel-heading">Finished games</h2>
      <table class="table">
        <thead><tr><th scope="col">White</th><th scope="col">Black</th><th scope="col">Result</th><th scope="col">Reason</th><th scope="col">Rated</th><th scope="col">Action</th></tr></thead>
        <tbody>
          ${games.map((game) => `<tr data-game-row="${escapeAttr(game.id)}">
            <td>${escapeHtml(game.white_username || 'The house')}</td>
            <td>${escapeHtml(game.black_username || 'The house')}</td>
            <td class="mono">${escapeHtml(game.result)}</td>
            <td>${escapeHtml(game.end_reason || '')}</td>
            <td>${game.rated ? 'yes' : 'no'}</td>
            <td>${game.rated
              ? `<button type="button" class="button button-danger" data-void="${escapeAttr(game.id)}">Void</button>`
              : '<span class="quiet">voided</span>'}
              <a class="button button-quiet" href="/game/${escapeAttr(game.id)}/record">Record</a></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${games.length ? '' : emptyState('No finished rated games yet.')}
    </section>
    <section class="panel">
      <h2 class="panel-heading">Audit</h2>
      ${audits.length ? `<table class="table" id="audit-table">
        <thead><tr><th scope="col">Member</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Administrator</th><th scope="col">When</th></tr></thead>
        <tbody>
          ${audits.map((row) => `<tr>
            <td>${escapeHtml(row.member_username)}</td>
            <td class="mono">${row.rating_before}</td>
            <td class="mono">${row.rating_after}</td>
            <td>${escapeHtml(row.admin_username)}</td>
            <td>${escapeHtml(new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' '))} UTC</td>
          </tr>`).join('')}
        </tbody>
      </table>` : emptyState('Nothing has been voided.')}
    </section>
    <p class="toast" id="toast" role="alert" hidden></p>
  </div>`;
  res.send(layout({ member, title: 'Void a game', body, active: null, unread, scripts: ['/js/admin.js'] }));
}));
