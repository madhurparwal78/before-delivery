// One game: three views of one position, and every refusal shown beside the board.
import { announce, api, playSound, reducedMotion, showFieldError, toast, viewer } from './app.js';
import { FlatBoard, SquareGrid, kingSquare, piecesFromFen, squareLabel, turnFromFen } from './board.js';

const node = document.getElementById('game-data');
let game = JSON.parse(node.textContent);
const orientation = game.viewer_side === 'black' ? 'black' : 'white';
const myColours = game.viewer_side === 'both'
  ? ['white', 'black']
  : (game.viewer_side ? [game.viewer_side] : []);

let selected = null;
let legalFrom = new Map();
let renderedFen = game.fen;
let deepView = null;
let busy = false;

const flat = new FlatBoard(document.getElementById('flat-board'), orientation, onSquare);
const grid = new SquareGrid(document.getElementById('square-list'), orientation, onSquare);

function buildLegal() {
  legalFrom = new Map();
  (game.legal_moves || []).forEach((uci) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    if (!legalFrom.has(from)) legalFrom.set(from, new Set());
    legalFrom.get(from).add(to);
  });
}

function viewState(fen = renderedFen) {
  const pieces = piecesFromFen(fen);
  const check = game.check && game.status === 'in_progress'
    ? kingSquare(pieces, turnFromFen(fen)) : null;
  return {
    pieces,
    selected,
    legal: selected ? (legalFrom.get(selected) || new Set()) : null,
    lastMove: game.last_move,
    check,
    toppled: toppledKing(fen),
  };
}

function paint(fen = renderedFen) {
  const state = viewState(fen);
  flat.render(state);
  grid.render(state);
  grid.setRoving();
  if (deepView) {
    deepView.render({
      ...state,
      legal: state.legal ? Array.from(state.legal) : null,
      toppleKing: toppledKing(fen),
    });
  }
}

function toppledKing(fen) {
  if (game.status !== 'finished' || !['1-0', '0-1'].includes(game.result)) return null;
  const pieces = piecesFromFen(fen);
  return kingSquare(pieces, game.result === '1-0' ? 'black' : 'white');
}

/* ------------------------------------------------------------------ moving */

function canMoveNow() {
  return game.status === 'in_progress' && myColours.includes(game.turn);
}

async function onSquare(square) {
  if (square === null) {
    selected = null;
    paint();
    announce('Selection cancelled.');
    return;
  }
  const pieces = piecesFromFen(renderedFen);
  if (!canMoveNow()) {
    announce(squareLabel(square, pieces[square]));
    if (game.status === 'in_progress' && myColours.length) {
      showFieldError('control-error', 'It is not your turn yet.');
    }
    return;
  }
  const mine = pieces[square] && pieces[square][0] === (game.turn === 'white' ? 'w' : 'b');
  if (!selected) {
    if (!mine) { announce(squareLabel(square, pieces[square])); return; }
    selected = square;
    paint();
    announce(`${squareLabel(square, pieces[square])} selected.`);
    return;
  }
  if (square === selected) { selected = null; paint(); return; }
  const targets = legalFrom.get(selected) || new Set();
  if (targets.has(square)) {
    const from = selected;
    selected = null;
    await playMove(from, square, pieces);
    return;
  }
  if (mine) { selected = square; paint(); announce(`${squareLabel(square, pieces[square])} selected.`); return; }
  selected = null;
  paint();
  showFieldError('control-error', 'That is not a legal destination for the selected piece.');
}

async function choosePromotion() {
  const dialog = document.getElementById('promotion-dialog');
  if (!dialog || !dialog.showModal) return 'q';
  return new Promise((resolve) => {
    const done = () => { dialog.removeEventListener('close', done); resolve(dialog.returnValue || 'q'); };
    dialog.addEventListener('close', done);
    dialog.showModal();
  });
}

async function playMove(from, to, piecesBefore) {
  if (busy) return;
  const piece = piecesBefore[from];
  let uci = from + to;
  if (piece && piece[1] === 'P' && (to[1] === '8' || to[1] === '1')) {
    const choice = await choosePromotion();
    uci += choice;
  }
  const capture = Boolean(piecesBefore[to])
    || (piece && piece[1] === 'P' && from[0] !== to[0] && !piecesBefore[to]);
  busy = true;
  setBusy(true);
  const plyBefore = game.ply_count;
  showFieldError('control-error', '');
  // The move is sent at once; the piece travels while the server answers.
  const sent = api(`/api/games/${game.id}/moves`, { method: 'POST', body: { move: uci } });
  const travel = animateOne(from, to, { knight: piece && piece[1] === 'N', capture });
  playSound(uci.length === 5 ? 'promotion' : (capture ? 'capture' : 'move'));
  try {
    const next = await sent;
    await travel;
    busy = false;
    setBusy(false);
    await applyGame(next, { animateFrom: plyBefore + 2 });
  } catch (error) {
    busy = false;
    setBusy(false);
    showFieldError('control-error', error.message);
    toast(error.message, 'bad');
    await refresh();
  }
}

function setBusy(on) {
  const line = document.getElementById('board-busy');
  if (line) line.hidden = !on;
}

async function animateOne(from, to, options) {
  const jobs = [flat.animateMove(from, to, options)];
  if (deepView && !document.getElementById('pane-deep').hidden) {
    jobs.push(deepView.animateMove(from, to, options));
  }
  await Promise.all(jobs);
}

/* ------------------------------------------------------------------ updates */

function describe(move) {
  return move.announcement || move.san;
}

async function applyGame(next, { animateFrom = null } = {}) {
  const previousPly = game.ply_count;
  const previousStatus = game.status;
  const newMoves = next.moves.slice(previousPly);
  let promoted = null;
  game = next;
  buildLegal();
  if (newMoves.length) {
    for (const move of newMoves) {
      const before = move.ply === 1 ? next.start_fen : next.moves[move.ply - 2].fen_after;
      const piecesBefore = piecesFromFen(before);
      const from = move.uci.slice(0, 2);
      const to = move.uci.slice(2, 4);
      const mover = piecesBefore[from];
      const capture = Boolean(piecesBefore[to]) || (mover && mover[1] === 'P' && from[0] !== to[0]);
      const alreadyShown = animateFrom !== null && move.ply < animateFrom;
      if (!alreadyShown) {
        renderedFen = before;
        paint(before);
        await animateOne(from, to, { knight: mover && mover[1] === 'N', capture });
        playSound(move.uci.length === 5 ? 'promotion' : (capture ? 'capture' : 'move'));
      }
      renderedFen = move.fen_after;
      paint(move.fen_after);
      if (move.uci.length === 5) promoted = to;  // popped after the final paint() rebuilds the board
      announce(describe(move));
    }
  }
  renderedFen = game.fen;
  paint();
  if (promoted) flat.popPromotion(promoted);
  paintSide();
  if (game.status !== previousStatus && game.status !== 'in_progress') showEnd();
}

function paintSide() {
  document.getElementById('fen-line').textContent = game.fen;
  document.getElementById('status-chip').textContent = game.status === 'in_progress'
    ? 'in progress' : `${game.status}${game.result && game.result !== '*' ? ` · ${game.result}` : ''}`;
  const turnText = game.status === 'in_progress'
    ? (game.turn === 'white' ? 'White to move' : 'Black to move')
    : `Finished · ${game.result}${game.end_reason ? ` · ${game.end_reason}` : ''}`;
  document.getElementById('turn-text').textContent = turnText;
  document.querySelectorAll('[data-turn-dot]').forEach((dot) => {
    dot.classList.toggle('on', game.status === 'in_progress' && dot.dataset.turnDot === game.turn);
  });

  const list = document.getElementById('move-list');
  if (game.moves.length) {
    const rows = [];
    for (let i = 0; i < game.moves.length; i += 2) {
      const white = game.moves[i] ? game.moves[i].san : '';
      const black = game.moves[i + 1] ? game.moves[i + 1].san : '';
      rows.push(`<li><span class="san">${white}</span> <span class="san">${black}</span></li>`);
    }
    list.innerHTML = `<ol>${rows.join('')}</ol>`;
    list.scrollTop = list.scrollHeight;
  } else {
    list.innerHTML = '<p class="empty">No moves yet.</p>';
  }

  const banners = document.getElementById('banners');
  banners.innerHTML = '';
  const amPlayer = Boolean(game.viewer_side);
  if (game.draw_offer_by && amPlayer) {
    const mine = game.draw_offer_by === viewer.username;
    banners.innerHTML += mine
      ? `<div class="banner offer">Your draw offer stands until ${otherName()} answers or moves.</div>`
      : `<div class="banner offer"><strong>${game.draw_offer_by}</strong> offers a draw.
          <span class="row-line" style="margin-top:6px">
            <button class="button small primary" data-draw="accept">Accept</button>
            <button class="button small" data-draw="decline">Decline</button></span></div>`;
  }
  if (game.takeback_by && amPlayer) {
    const mine = game.takeback_by === viewer.username;
    banners.innerHTML += mine
      ? '<div class="banner">Your takeback request is waiting on your opponent.</div>'
      : `<div class="banner"><strong>${game.takeback_by}</strong> asks for a takeback.
          <span class="row-line" style="margin-top:6px">
            <button class="button small primary" data-takeback="accept">Accept</button>
            <button class="button small" data-takeback="decline">Decline</button></span></div>`;
  }
  if (game.claims && (game.claims.threefold || game.claims['fifty-move']) && game.status === 'in_progress') {
    banners.innerHTML += `<div class="banner">A draw may be claimed:
      ${game.claims.threefold ? 'threefold repetition' : ''}
      ${game.claims['fifty-move'] ? 'fifty-move rule' : ''}.</div>`;
  }
  const rematch = document.getElementById('btn-rematch');
  if (rematch) {
    rematch.disabled = game.status === 'in_progress';
    document.getElementById('rematch-note').textContent = rematch.disabled ? 'A rematch opens when this game ends.' : '';
  }
}

function otherName() {
  return game.viewer_side === 'white' ? game.black.username : game.white.username;
}

/* ------------------------------------------------------------------ the end */

function showEnd() {
  const screen = document.getElementById('endscreen');
  const card = document.getElementById('endcard');
  const title = document.getElementById('end-title');
  const reason = document.getElementById('end-reason');
  const detail = document.getElementById('end-detail');
  card.classList.remove('win', 'loss', 'draw');
  const drawReasons = ['agreement', 'threefold claim', 'fifty-move claim', 'fivefold repetition',
    'insufficient material', 'stalemate'];
  if (game.result === '1/2-1/2') {
    card.classList.add('draw');
    title.textContent = 'Drawn';
    const word = drawReasons.includes(game.end_reason) ? game.end_reason : 'agreement';
    reason.textContent = word;
    playSound('draw');
  } else if (game.status === 'aborted') {
    card.classList.add('draw');
    title.textContent = 'Aborted';
    reason.textContent = 'no first move was played';
  } else {
    const iWon = (game.result === '1-0' && game.viewer_side === 'white')
      || (game.result === '0-1' && game.viewer_side === 'black');
    if (!game.viewer_side) {
      card.classList.add('draw');
      title.textContent = game.result === '1-0' ? 'White won' : 'Black won';
    } else if (iWon) {
      card.classList.add('win');
      title.textContent = 'You won';
      sparks(card);
      playSound('victory');
    } else {
      card.classList.add('loss');
      title.textContent = 'You lost';
      playSound('defeat');
    }
    reason.textContent = game.end_reason || '';
  }
  detail.textContent = `${game.result}${game.rated ? ' · rated' : ''}`;
  screen.hidden = false;
  document.getElementById('end-close').focus();
  trapFocus(screen);
}

let releaseTrap = null;

function trapFocus(screen) {
  const focusables = () => screen.querySelectorAll('button, a[href]');
  const onKey = (event) => {
    if (event.key === 'Escape') { closeEnd(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(focusables());
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  screen.addEventListener('keydown', onKey);
  releaseTrap = () => screen.removeEventListener('keydown', onKey);
}

function closeEnd() {
  document.getElementById('endscreen').hidden = true;
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  document.getElementById('board-region')?.focus();
}

function sparks(card) {
  if (reducedMotion()) return;
  for (let i = 0; i < 18; i += 1) {
    const spark = document.createElement('span');
    spark.className = 'spark';
    spark.style.left = '50%';
    spark.style.top = '30%';
    const angle = (i / 18) * Math.PI * 2;
    spark.style.setProperty('--sx', `${Math.cos(angle) * 140}px`);
    spark.style.setProperty('--sy', `${Math.sin(angle) * 140}px`);
    spark.style.animation = `spark-fly ${700 + i * 12}ms ease-out forwards`;
    card.appendChild(spark);
    setTimeout(() => spark.remove(), 1200);
  }
}

document.getElementById('end-close')?.addEventListener('click', closeEnd);

/* ------------------------------------------------------------------ views */

async function savePreference(body) {
  try { await api('/api/profile', { method: 'PATCH', body }); } catch { /* the view still switched */ }
}

async function switchView(view) {
  document.querySelectorAll('.view-switch button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  const flatPane = document.getElementById('pane-flat');
  const deepPane = document.getElementById('pane-deep');
  flatPane.hidden = view !== 'flat';
  deepPane.hidden = view !== 'deep';
  document.getElementById('board-stage').dataset.view = view;
  if (view === 'deep') {
    if (!deepView) {
      const module = await import('/static/js/deep.js');
      deepView = module.createDeepView(document.getElementById('deep-wrap'), {
        orientation, onSquare,
      });
    }
    deepView.resize();
    paint();
  }
  savePreference({ view });
}

document.querySelectorAll('.view-switch button').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

/* ------------------------------------------------- the side column as tabs on a phone */

function showTab(name) {
  document.querySelectorAll('[data-tab-button]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tabButton === name));
  });
  document.querySelectorAll('.side-column [data-tab]').forEach((panel) => {
    panel.classList.toggle('tab-active', panel.dataset.tab === name);
  });
}

document.querySelectorAll('[data-tab-button]').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tabButton));
});
showTab('moves');

/* ------------------------------------------------------------------ controls */

async function control(path, body) {
  showFieldError('control-error', '');
  try {
    const next = await api(`/api/games/${game.id}/${path}`, { method: 'POST', body });
    await applyGame(next);
    return next;
  } catch (error) {
    showFieldError('control-error', error.message);
    toast(error.message, 'bad');
    return null;
  }
}

document.getElementById('btn-draw-offer')?.addEventListener('click', () => control('draw-offer'));
document.getElementById('btn-takeback')?.addEventListener('click', () => control('takeback'));
document.getElementById('btn-resign')?.addEventListener('click', () => control('resign'));
document.getElementById('btn-claim')?.addEventListener('click', () => {
  const kind = game.claims && game.claims['fifty-move'] && !game.claims.threefold ? 'fifty-move' : 'threefold';
  control('claim', { kind });
});
document.getElementById('btn-rematch')?.addEventListener('click', async () => {
  try {
    const next = await api(`/api/games/${game.id}/rematch`, { method: 'POST' });
    window.location.href = `/game/${next.id}`;
  } catch (error) { showFieldError('control-error', error.message); }
});
document.getElementById('banners')?.addEventListener('click', (event) => {
  const draw = event.target.closest('[data-draw]');
  if (draw) control('draw-response', { accept: draw.dataset.draw === 'accept' });
  const takeback = event.target.closest('[data-takeback]');
  if (takeback) control('takeback-response', { accept: takeback.dataset.takeback === 'accept' });
});

/* ------------------------------------------------------------------ chat */

const chatForm = document.getElementById('chat-form');
let lastChatId = null;

function appendChat(message) {
  const scroll = document.getElementById('chat-scroll');
  if (!scroll) return;
  document.getElementById('chat-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'chat-msg';
  row.dataset.id = message.id;
  const image = document.createElement('img');
  image.className = 'avatar';
  image.width = 28; image.height = 28; image.alt = '';
  image.src = message.avatar_url;
  const body = document.createElement('div');
  const who = document.createElement('div');
  who.className = 'chat-who';
  who.textContent = message.username;
  const text = document.createElement('div');
  text.className = 'chat-text';
  text.textContent = message.text;
  body.append(who, text);
  row.append(image, body);
  scroll.appendChild(row);
  scroll.scrollTop = scroll.scrollHeight;
  lastChatId = message.id;
}

if (chatForm) {
  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value;
    showFieldError('chat-error', '');
    if (!text.trim()) { showFieldError('chat-error', 'A message cannot be empty.'); return; }
    try {
      const message = await api(`/api/games/${game.id}/chat`, { method: 'POST', body: { text } });
      input.value = '';
      appendChat(message);
    } catch (error) { showFieldError('chat-error', error.message); }
  });
}

/* ------------------------------------------------------------------ live */

async function refresh() {
  try {
    const next = await api(`/api/games/${game.id}`);
    const changed = next.fen !== game.fen || next.status !== game.status
      || next.draw_offer_by !== game.draw_offer_by || next.takeback_by !== game.takeback_by
      || next.ply_count !== game.ply_count;
    if (changed) await applyGame(next);
  } catch { /* the next tick will try again */ }
}

async function refreshChat() {
  if (!game.viewer_is_player) return;
  try {
    const rows = await api(`/api/games/${game.id}/chat?limit=100`);
    const seen = new Set(Array.from(document.querySelectorAll('#chat-scroll [data-id]')).map((n) => n.dataset.id));
    const existing = document.querySelectorAll('#chat-scroll .chat-msg').length;
    if (!existing && rows.length) { rows.forEach(appendChat); return; }
    rows.slice(Math.max(0, existing)).forEach((message) => {
      if (!seen.has(message.id)) appendChat(message);
    });
  } catch { /* later */ }
}

window.setInterval(() => { if (!busy) { refresh(); refreshChat(); } }, 2500);

/* ------------------------------------------------------------------ start */

buildLegal();
paint();
paintSide();
document.querySelectorAll('#chat-scroll .chat-msg').forEach(() => {});
if (game.status !== 'in_progress') showEnd();
const startView = (viewer && viewer.view) || 'flat';
if (startView !== 'flat') switchView(startView);
