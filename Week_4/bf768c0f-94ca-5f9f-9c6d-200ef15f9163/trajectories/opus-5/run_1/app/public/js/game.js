/**
 * The game screen: one position through three views, played by pointer or by
 * the keyboard alone, with the six animations, the six sounds, the live-region
 * announcement, the chat and the game controls.  Nothing here decides whether
 * a move is legal: the server refuses the call regardless of what the page drew.
 */

import { api, toast, announce, setStatus, reducedMotion } from './app.js';
import { pieceSvg, pieceLabel } from './pieces.js';
import {
  animateMove, animateCapture, animatePromotion, animateOutcome,
} from './anim.js';
import { playSound } from './sound.js';

const screen = document.getElementById('game-screen');
if (screen) start();

function start() {
  const grid = document.getElementById('board-grid');
  const stage = document.getElementById('board-stage');
  const overlay = document.getElementById('board-overlay');
  const canvas = document.getElementById('deep-canvas');
  const deepNote = document.getElementById('deep-note');

  const state = {
    gameId: screen.dataset.gameId,
    fen: screen.dataset.fen,
    turn: screen.dataset.turn,
    side: screen.dataset.side,
    flip: screen.dataset.flip === '1',
    status: screen.dataset.status,
    ply: Number(screen.dataset.ply || 0),
    set2d: screen.dataset.set2d,
    set3d: screen.dataset.set3d,
    view: screen.dataset.view,
    legal: (screen.dataset.legal || '').split(' ').filter(Boolean),
    squares: null,
    selected: null,
    game: null,
    chatIds: new Set(),
    deep: null,
    pendingPromotion: null,
    busy: false,
  };

  document.querySelectorAll('.chat-message').forEach((node) => state.chatIds.add(node.dataset.messageId));

  // The first response already carries the whole game, so the board is
  // playable before any call is made.
  const embedded = document.getElementById('game-state');

  const isPlayer = state.side === 'white' || state.side === 'black' || state.side === 'both';

  // ----------------------------------------------------------------- squares

  function squareElement(name) {
    return grid?.querySelector(`[data-square="${name}"]`);
  }

  function orderedSquares(squares) {
    return state.flip ? [...squares].reverse() : squares;
  }

  function renderSquares(squares) {
    if (!grid) return;
    const focused = document.activeElement?.dataset?.square || null;
    const ordered = orderedSquares(squares);
    const rows = [];
    for (let row = 0; row < 8; row++) {
      let html = '<div class="board-row" role="row">';
      for (let column = 0; column < 8; column++) {
        const square = ordered[row * 8 + column];
        const label = square.pieceName ? `${square.name}, ${square.pieceName}` : square.name;
        const edgeFile = state.flip ? row === 0 : row === 7;
        const edgeRank = state.flip ? column === 7 : column === 0;
        const coords = `${edgeRank ? `<span class="sq-coord sq-rank" aria-hidden="true">${square.rank}</span>` : ''}${edgeFile ? `<span class="sq-coord sq-file" aria-hidden="true">${square.file}</span>` : ''}`;
        html += `<button type="button" role="gridcell" class="square square-${square.shade}"
          data-square="${square.name}" data-piece="${square.piece || ''}"
          aria-label="${label.replace(/"/g, '&quot;')}" tabindex="${square.name === (focused || 'a1') ? '0' : '-1'}">
          ${coords}<span class="sq-piece">${square.piece ? pieceSvg(state.set2d, square.piece) : ''}</span>
          <span class="sq-name" aria-hidden="true">${square.name}</span>
          <span class="sq-occupant" aria-hidden="true">${square.pieceName || ''}</span>
        </button>`;
      }
      rows.push(`${html}</div>`);
    }
    grid.innerHTML = rows.join('');
    grid.dataset.fen = state.fen;
    if (focused) squareElement(focused)?.focus({ preventScroll: true });
  }

  function markLastMove() {
    const last = state.game?.last_move;
    if (!last) return;
    squareElement(last.from)?.classList.add('is-last');
    squareElement(last.to)?.classList.add('is-last');
  }

  function markCheck() {
    if (!state.game || state.game.status !== 'in_progress') return;
    const moves = state.game.moves;
    if (!moves.length) return;
    const announcement = moves[moves.length - 1].announcement || '';
    if (!announcement.endsWith(', check')) return;
    const wanted = state.turn === 'white' ? 'K' : 'k';
    const kingSquare = state.squares.find((square) => square.piece === wanted);
    if (kingSquare) squareElement(kingSquare.name)?.classList.add('is-check');
  }

  function kingSquareOf(colour) {
    const wanted = colour === 'white' ? 'K' : 'k';
    const found = state.squares?.find((square) => square.piece === wanted);
    return found ? squareElement(found.name) : null;
  }

  // --------------------------------------------------------------- selection

  function destinationsFrom(name) {
    return state.legal
      .filter((uci) => uci.slice(0, 2) === name)
      .map((uci) => uci.slice(2, 4));
  }

  function clearMarks() {
    grid?.querySelectorAll('.square').forEach((node) => {
      node.classList.remove('is-selected', 'is-hint', 'is-hint-capture');
    });
  }

  function syncDeep() {
    if (!state.deep?.available) return;
    state.deep.setState({
      squares: state.squares,
      flip: state.flip,
      set3d: state.set3d,
      lastMove: state.game?.last_move || null,
      selected: state.selected,
      hints: state.selected ? destinationsFrom(state.selected) : [],
      check: checkSquareName(),
    });
  }

  function checkSquareName() {
    if (!state.game || state.game.status !== 'in_progress') return null;
    const moves = state.game.moves;
    if (!moves.length) return null;
    if (!String(moves[moves.length - 1].announcement || '').endsWith(', check')) return null;
    const wanted = state.turn === 'white' ? 'K' : 'k';
    return state.squares.find((square) => square.piece === wanted)?.name || null;
  }

  function select(name) {
    const square = state.squares.find((item) => item.name === name);
    if (!square || !square.piece) return;
    const destinations = destinationsFrom(name);
    if (!destinations.length) {
      setStatus(`${pieceLabel(square.piece)} on ${name} has no legal move.`);
      return;
    }
    state.selected = name;
    clearMarks();
    squareElement(name)?.classList.add('is-selected');
    for (const destination of destinations) {
      const target = state.squares.find((item) => item.name === destination);
      squareElement(destination)?.classList.add(target?.piece ? 'is-hint-capture' : 'is-hint');
    }
    setStatus(`${pieceLabel(square.piece)} on ${name} selected. ${destinations.length} moves available.`);
    syncDeep();
  }

  function clearSelection() {
    state.selected = null;
    clearMarks();
    markLastMove();
    markCheck();
    syncDeep();
  }

  function activate(name) {
    if (state.status !== 'in_progress') return;
    if (!isPlayer) {
      toast('You are watching this game. Only its two players may move in it.', 'error');
      return;
    }
    if (state.side !== 'both' && state.side !== state.turn) {
      toast('It is not your turn yet.', 'error');
      return;
    }
    if (state.selected && state.selected !== name) {
      const destinations = destinationsFrom(state.selected);
      if (destinations.includes(name)) {
        const promotions = state.legal.filter((uci) => uci.startsWith(state.selected + name) && uci.length === 5);
        if (promotions.length) {
          openPromotion(state.selected, name);
          return;
        }
        submit(`${state.selected}${name}`);
        return;
      }
    }
    const square = state.squares.find((item) => item.name === name);
    if (square?.piece && destinationsFrom(name).length) {
      select(name);
      return;
    }
    clearSelection();
  }

  // --------------------------------------------------------------- keyboard

  function focusSquare(name) {
    const node = squareElement(name);
    if (!node) return;
    grid.querySelectorAll('.square').forEach((square) => { square.tabIndex = -1; });
    node.tabIndex = 0;
    node.focus({ preventScroll: true });
  }

  function step(name, dx, dy) {
    const files = 'abcdefgh';
    let file = files.indexOf(name[0]);
    let rank = Number(name[1]);
    const direction = state.flip ? -1 : 1;
    file += dx * direction;
    rank += dy * direction;
    file = Math.min(7, Math.max(0, file));
    rank = Math.min(8, Math.max(1, rank));
    return `${files[file]}${rank}`;
  }

  grid?.addEventListener('keydown', (event) => {
    const current = event.target?.dataset?.square;
    if (!current) return;
    const keys = {
      ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    if (keys[event.key]) {
      event.preventDefault();
      focusSquare(step(current, keys[event.key][0], keys[event.key][1]));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusSquare(`a${current[1]}`);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusSquare(`h${current[1]}`);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(current);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSelection();
      setStatus('Selection cancelled.');
    }
  });

  grid?.addEventListener('click', (event) => {
    const button = event.target.closest('.square');
    if (!button) return;
    activate(button.dataset.square);
  });

  // -------------------------------------------------------------- promotion

  const promotionDialog = document.getElementById('promotion-dialog');
  let lastFocus = null;

  function openPromotion(from, to) {
    state.pendingPromotion = { from, to };
    if (!promotionDialog) {
      submit(`${from}${to}q`);
      return;
    }
    lastFocus = document.activeElement;
    promotionDialog.hidden = false;
    promotionDialog.querySelector('[data-promote]')?.focus();
  }

  function closePromotion() {
    state.pendingPromotion = null;
    if (promotionDialog) promotionDialog.hidden = true;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  promotionDialog?.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-promote]');
    if (choice) {
      const { from, to } = state.pendingPromotion || {};
      const piece = choice.dataset.promote;
      closePromotion();
      if (from && to) submit(`${from}${to}${piece}`);
      return;
    }
    if (event.target.closest('[data-promote-cancel]') || event.target === promotionDialog) {
      closePromotion();
      clearSelection();
    }
  });

  promotionDialog?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePromotion();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...promotionDialog.querySelectorAll('button')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // ------------------------------------------------------------ submitting

  async function submit(uci) {
    if (state.busy) return;
    state.busy = true;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const mover = state.squares.find((square) => square.name === from);
    const target = state.squares.find((square) => square.name === to);
    clearMarks();
    // The move shows on the board at once rather than blocking the page.
    if (mover) {
      if (target?.piece) animateCapture(overlay, squareElement(to), target.piece, state.set2d);
      animateMove(overlay, squareElement(from), squareElement(to), mover.piece, state.set2d);
      if (state.deep?.available) {
        state.deep.travel({
          from, to, piece: mover.piece,
          captured: target?.piece ? { square: to, piece: target.piece } : null,
        });
      }
    }
    try {
      const game = await api('POST', `/api/games/${state.gameId}/moves`, { move: uci, fen: state.fen });
      state.selected = null;
      applyGame(game, { animateFromPly: state.ply, skipFirstTravel: true });
    } catch (error) {
      toast(error.message, 'error');
      await refresh({ quiet: true });
    } finally {
      state.busy = false;
    }
  }

  // --------------------------------------------------------------- rendering

  function renderMoveList(moves) {
    const frame = document.getElementById('move-list-frame');
    if (!frame) return;
    if (!moves.length) {
      frame.innerHTML = '<p class="empty-state" id="move-list-empty">No moves yet. White begins.</p>';
      return;
    }
    let html = '<ol class="move-list" id="move-list">';
    for (let i = 0; i < moves.length; i += 2) {
      const white = moves[i];
      const black = moves[i + 1];
      html += `<li class="move-row"><span class="move-number">${i / 2 + 1}.</span>
        <span class="move-san${white.ply === moves.length ? ' is-latest' : ''}" data-ply="${white.ply}">${white.san}</span>
        ${black ? `<span class="move-san${black.ply === moves.length ? ' is-latest' : ''}" data-ply="${black.ply}">${black.san}</span>` : '<span class="move-san is-empty"></span>'}
      </li>`;
    }
    frame.innerHTML = `${html}</ol>`;
    frame.scrollTop = frame.scrollHeight;
  }

  function renderTurn(game) {
    document.querySelectorAll('[data-turn-marker]').forEach((marker) => {
      const on = game.status === 'in_progress' && marker.dataset.turnMarker === game.turn;
      marker.classList.toggle('is-on', on);
      marker.querySelector('span:last-child').textContent = on ? 'to move' : '';
    });
    const chip = document.getElementById('status-chip');
    if (chip) {
      chip.textContent = game.status === 'in_progress'
        ? `${game.turn === 'white' ? 'White' : 'Black'} to move`
        : game.result;
    }
    const claims = document.getElementById('claims-note');
    if (claims) {
      claims.querySelector('[data-claim-state="threefold"]').textContent = game.claims.threefold ? 'available' : 'not yet';
      claims.querySelector('[data-claim-state="fifty-move"]').textContent = game.claims['fifty-move'] ? 'available' : 'not yet';
    }
    document.querySelectorAll('[data-action="rematch"]').forEach((button) => {
      button.disabled = game.status === 'in_progress';
    });
    ['draw-offer', 'claim', 'takeback', 'resign'].forEach((action) => {
      document.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
        button.disabled = game.status !== 'in_progress';
      });
    });
  }

  function renderOffers(game) {
    const panel = document.getElementById('offer-panel');
    if (!panel) return;
    const me = document.documentElement.dataset.member;
    const rows = [];
    if (game.draw_offer_by) {
      const mine = game.draw_offer_by === me;
      rows.push(`<div class="offer-row" data-offer="draw"><p>${mine ? 'You have offered a draw. Waiting for an answer.' : `${escapeText(game.draw_offer_by)} offers a draw.`}</p>
        ${!mine && isPlayer ? `<div class="offer-actions">
          <button type="button" class="button button-primary" data-action="draw-accept">Accept</button>
          <button type="button" class="button button-quiet" data-action="draw-decline">Decline</button></div>` : ''}</div>`);
    }
    if (game.takeback_by) {
      const mine = game.takeback_by === me;
      rows.push(`<div class="offer-row" data-offer="takeback"><p>${mine ? 'You have asked for a takeback. Waiting for an answer.' : `${escapeText(game.takeback_by)} asks for a takeback.`}</p>
        ${!mine && isPlayer ? `<div class="offer-actions">
          <button type="button" class="button button-primary" data-action="takeback-accept">Accept</button>
          <button type="button" class="button button-quiet" data-action="takeback-decline">Decline</button></div>` : ''}</div>`);
    }
    panel.innerHTML = rows.join('');
    panel.hidden = rows.length === 0;
  }

  function escapeText(value) {
    const node = document.createElement('span');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  }

  const REASON_WORDS = {
    checkmate: 'checkmate', resignation: 'resignation', agreement: 'agreement',
    'threefold claim': 'threefold claim', 'fifty-move claim': 'fifty-move claim',
    'fivefold repetition': 'fivefold repetition', 'insufficient material': 'insufficient material',
    stalemate: 'stalemate', deadline: 'deadline', void: 'void',
  };

  function outcomeFor(game) {
    if (game.result === '1/2-1/2') return 'draw';
    const winner = game.result === '1-0' ? 'white' : 'black';
    if (state.side === 'white' || state.side === 'black') {
      return state.side === winner ? 'victory' : 'defeat';
    }
    return winner === 'white' ? 'white-won' : 'black-won';
  }

  function renderResultScreen(game) {
    const existing = document.getElementById('result-screen');
    if (game.status !== 'finished') {
      existing?.remove();
      return null;
    }
    const outcome = outcomeFor(game);
    const reason = REASON_WORDS[game.end_reason] || game.end_reason || '';
    const drawn = game.result === '1/2-1/2';
    const headings = {
      victory: 'You won', defeat: 'You lost', draw: 'Drawn',
      'white-won': 'White won', 'black-won': 'Black won',
    };
    const loser = drawn ? '' : (game.result === '1-0' ? 'black' : 'white');
    const html = `<div class="result-screen is-${outcome}" id="result-screen" data-outcome="${outcome}"
        data-reason="${escapeText(reason)}" data-loser="${loser}" role="group" aria-label="Result">
      <h2 class="result-heading">${headings[outcome]}</h2>
      <p class="result-reason">${drawn ? `Drawn by <strong>${escapeText(reason)}</strong>.` : `By <strong>${escapeText(reason)}</strong>. The result is ${escapeText(game.result)}.`}</p>
      <p class="result-rating">${game.rated ? 'This game was rated.' : 'This game moved no rating.'}</p>
      <div class="result-actions">
        <button type="button" class="button button-primary" data-action="rematch">Rematch</button>
        <a class="button button-quiet" href="/hall">Back to the hall</a>
        <a class="button button-quiet" href="/game/${game.id}/record">Game record</a>
      </div>
    </div>`;
    if (existing) {
      existing.outerHTML = html;
    } else {
      document.querySelector('.game-main')?.insertAdjacentHTML('beforeend', html);
    }
    return document.getElementById('result-screen');
  }

  /** Take the game the server returned and show it. */
  function applyGame(game, { skipFirstTravel = false, quiet = false } = {}) {
    const previousPly = state.ply;
    const previousStatus = state.status;
    state.game = game;
    state.fen = game.fen;
    state.turn = game.turn;
    state.status = game.status;
    state.ply = game.moves.length;
    state.legal = game.legal_moves || [];
    state.squares = game.squares;
    screen.dataset.fen = game.fen;
    screen.dataset.turn = game.turn;
    screen.dataset.status = game.status;
    screen.dataset.ply = String(state.ply);

    renderSquares(game.squares);
    markLastMove();
    markCheck();
    renderMoveList(game.moves);
    renderTurn(game);
    renderOffers(game);
    syncDeep();

    const fresh = game.moves.slice(previousPly);
    if (fresh.length && !quiet) {
      fresh.forEach((move, index) => {
        const delay = index * (reducedMotion() ? 0 : 420);
        window.setTimeout(() => {
          announce(move.announcement);
          const node = document.getElementById('move-announcement');
          if (node) node.textContent = move.announcement;
          const isCapture = move.announcement.includes(' takes ');
          const isPromotion = move.announcement.includes('promoted to');
          if (isPromotion) {
            playSound('promotion');
            animatePromotion(squareElement(move.uci.slice(2, 4)));
          } else if (isCapture) {
            playSound('capture');
          } else {
            playSound('move');
          }
          const travelled = skipFirstTravel && index === 0;
          if (!travelled) {
            const from = move.uci.slice(0, 2);
            const to = move.uci.slice(2, 4);
            animateMove(overlay, squareElement(from), squareElement(to), game.squares.find((s) => s.name === to)?.piece || 'P', state.set2d);
            if (state.deep?.available) {
              state.deep.travel({ from, to, piece: game.squares.find((s) => s.name === to)?.piece || 'P' });
            }
          }
        }, delay);
      });
    }

    const screenNode = renderResultScreen(game);
    const justFinished = game.status === 'finished' && (previousStatus !== 'finished' || fresh.length > 0);
    if (justFinished && !quiet) {
      const outcome = outcomeFor(game);
      const loser = game.result === '1-0' ? 'black' : 'white';
      const winner = game.result === '1-0' ? 'white' : 'black';
      // The outcome plays as soon as the result lands, over the last move.
      window.requestAnimationFrame(() => {
        animateOutcome({
          outcome,
          container: overlay,
          winnerKing: kingSquareOf(winner),
          loserKing: kingSquareOf(loser),
          whiteKing: kingSquareOf('white'),
          blackKing: kingSquareOf('black'),
          resultScreen: screenNode,
        });
        playSound(outcome === 'victory' ? 'victory' : outcome === 'defeat' ? 'defeat' : outcome === 'draw' ? 'draw' : 'victory');
      });
    }
  }

  // ------------------------------------------------------------- the views

  function applyView(view) {
    state.view = view;
    stage.dataset.view = view;
    screen.dataset.view = view;
    document.querySelectorAll('[data-view-choice]').forEach((button) => {
      const active = button.dataset.viewChoice === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (view === 'deep') startDeep();
    const hint = document.getElementById('board-hint');
    if (hint) {
      hint.textContent = view === 'deep'
        ? 'Click a piece and then a marked square to move. Drag to turn the board, scroll to zoom. The sixty-four named squares are still here for the keyboard.'
        : 'Arrow keys move between squares, Enter picks up and puts down a piece, Escape cancels.';
    }
    api('PATCH', '/api/profile', { view }).catch(() => {});
  }

  async function startDeep() {
    if (state.deep || !canvas) return;
    try {
      const module = await import('./deep.js');
      const board = module.createDeepBoard(canvas, {
        onPick: (square) => activate(square),
      });
      state.deep = board;
      if (!board.available) {
        if (deepNote) {
          deepNote.hidden = false;
          deepNote.textContent = 'This browser offers no hardware graphics, so the deep board cannot be drawn. The flat board and the square list show the same position.';
        }
        return;
      }
      canvas.setAttribute('aria-hidden', 'true');
      syncDeep();
    } catch (error) {
      if (deepNote) {
        deepNote.hidden = false;
        deepNote.textContent = 'The deep board could not start. The flat board and the square list show the same position.';
      }
    }
  }

  document.querySelectorAll('[data-view-choice]').forEach((button) => {
    button.addEventListener('click', () => applyView(button.dataset.viewChoice));
  });

  document.querySelectorAll('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach((other) => {
        other.classList.toggle('is-active', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      });
      document.querySelectorAll('.side-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === tab.getAttribute('aria-controls'));
      });
    });
  });

  // ------------------------------------------------------------------- chat

  const chatForm = document.getElementById('chat-form');
  const chatList = document.getElementById('chat-list');

  chatForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const error = document.getElementById('chat-error');
    const text = input.value;
    if (error) error.textContent = '';
    if (!text.trim()) {
      if (error) error.textContent = 'A message cannot be empty.';
      return;
    }
    try {
      const message = await api('POST', `/api/games/${state.gameId}/chat`, { text });
      input.value = '';
      appendChat(message);
    } catch (err) {
      if (error) error.textContent = err.message;
    }
  });

  function appendChat(message) {
    if (!chatList || state.chatIds.has(message.id)) return;
    state.chatIds.add(message.id);
    chatList.querySelector('.chat-empty')?.remove();
    const item = document.createElement('li');
    item.className = `chat-message${message.username === document.documentElement.dataset.member ? ' is-mine' : ''}`;
    item.dataset.messageId = message.id;
    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = message.avatar_url;
    avatar.width = 28;
    avatar.height = 28;
    avatar.alt = '';
    const body = document.createElement('div');
    body.className = 'chat-body';
    const author = document.createElement('span');
    author.className = 'chat-author';
    author.textContent = message.username;
    const text = document.createElement('p');
    text.className = 'chat-text';
    text.textContent = message.text;
    body.append(author, text);
    item.append(avatar, body);
    chatList.append(item);
    chatList.scrollTop = chatList.scrollHeight;
  }

  // --------------------------------------------------------------- controls

  async function act(path, body, note) {
    try {
      const game = await api('POST', `/api/games/${state.gameId}/${path}`, body);
      if (note) toast(note);
      applyGame(game);
      return game;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action], [data-claim]');
    if (!button) return;
    const action = button.dataset.action;
    if (button.dataset.claim) {
      await act('claim', { kind: button.dataset.claim }, 'Claim sent.');
      document.getElementById('claim-chooser').hidden = true;
      return;
    }
    if (action === 'draw-offer') await act('draw-offer', undefined, 'Draw offered.');
    if (action === 'draw-accept') await act('draw-response', { accept: true });
    if (action === 'draw-decline') await act('draw-response', { accept: false }, 'Draw declined.');
    if (action === 'takeback') await act('takeback', undefined, 'Takeback requested.');
    if (action === 'takeback-accept') await act('takeback-response', { accept: true }, 'Takeback accepted.');
    if (action === 'takeback-decline') await act('takeback-response', { accept: false }, 'Takeback declined.');
    if (action === 'resign') {
      if (window.confirm('Resign this game?')) await act('resign', undefined, 'You resigned.');
    }
    if (action === 'claim') {
      const chooser = document.getElementById('claim-chooser');
      if (chooser) chooser.hidden = !chooser.hidden;
    }
    if (action === 'rematch') {
      try {
        const game = await api('POST', `/api/games/${state.gameId}/rematch`);
        window.location.href = `/game/${game.id}`;
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  // ------------------------------------------------- everything else arrives

  async function refresh({ quiet = false } = {}) {
    try {
      const game = await api('GET', `/api/games/${state.gameId}`);
      const moved = game.moves.length !== state.ply;
      const changed = moved || game.status !== state.status
        || game.draw_offer_by !== (state.game?.draw_offer_by ?? null)
        || game.takeback_by !== (state.game?.takeback_by ?? null);
      if (changed) {
        applyGame(game, { quiet });
      } else {
        state.game = game;
      }
      if (chatList) {
        const messages = await api('GET', `/api/games/${state.gameId}/chat`);
        for (const message of messages) appendChat(message);
      }
    } catch (error) {
      setStatus('The club could not be reached. Trying again shortly.');
    }
  }

  if (embedded) {
    try {
      applyGame(JSON.parse(embedded.textContent), { quiet: true });
    } catch (error) {
      setStatus('The position could not be read from the page. Fetching it again.');
    }
  }

  // The first paint already carries the position; this keeps it current.
  refresh({ quiet: true });
  window.setInterval(() => refresh(), 3000);
  applyView(state.view);
  window.addEventListener('resize', () => state.deep?.resize?.());
}
