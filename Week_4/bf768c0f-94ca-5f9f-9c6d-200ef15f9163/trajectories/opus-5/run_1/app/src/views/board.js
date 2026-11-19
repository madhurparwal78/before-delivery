/**
 * The board, rendered server-side: one position shown as a flat board, a
 * board with depth and a grid of sixty-four named squares.  The first
 * response already carries the position.
 */

import { pieceSvg, pieceLabel } from '../../public/js/pieces.js';
import { escapeHtml, escapeAttr, icon } from './layout.js';
import { boardSquares } from '../chess.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * The sixty-four squares.  Each is a control whose accessible name is its
 * algebraic name, extended with its occupant when a piece stands there.
 */
export function renderSquares(fen, { flip = false, set2d = 'Classic', lastMove = null } = {}) {
  const squares = boardSquares(fen);
  const ordered = flip ? [...squares].reverse() : squares;
  let html = '';
  for (let row = 0; row < 8; row++) {
    html += '<div class="board-row" role="row">';
    for (let column = 0; column < 8; column++) {
      const square = ordered[row * 8 + column];
      const label = square.pieceName ? `${square.name}, ${square.pieceName}` : square.name;
      const edgeFile = flip ? row === 0 : row === 7;
      const edgeRank = flip ? column === 7 : column === 0;
      const coords = [
        edgeRank ? `<span class="sq-coord sq-rank" aria-hidden="true">${square.rank}</span>` : '',
        edgeFile ? `<span class="sq-coord sq-file" aria-hidden="true">${square.file}</span>` : '',
      ].join('');
      const isLast = lastMove && (lastMove.from === square.name || lastMove.to === square.name);
      html += `<button type="button" role="gridcell" class="square square-${square.shade}${isLast ? ' is-last' : ''}"
        data-square="${square.name}" data-piece="${escapeAttr(square.piece || '')}"
        aria-label="${escapeAttr(label)}" tabindex="${square.name === 'a1' ? '0' : '-1'}">
        ${coords}<span class="sq-piece">${square.piece ? pieceSvg(set2d, square.piece) : ''}</span>
        <span class="sq-name" aria-hidden="true">${square.name}</span>
        <span class="sq-occupant" aria-hidden="true">${escapeHtml(square.pieceName || '')}</span>
      </button>`;
    }
    html += '</div>';
  }
  return html;
}

export function renderViewSwitch(view) {
  const options = [
    ['flat', 'Flat board', 'grid'],
    ['deep', 'Deep board', 'cube'],
    ['squares', 'Square list', 'keyboard'],
  ];
  return `<div class="view-switch" role="group" aria-label="Board view">
    ${options.map(([value, label, iconName]) => `
      <button type="button" class="view-button${view === value ? ' is-active' : ''}" data-view-choice="${value}"
        aria-pressed="${view === value}">${icon(iconName)}<span>${escapeHtml(label)}</span></button>`).join('')}
  </div>`;
}

export function renderBoardStage(game, { view = 'flat', flip = false, set2d = 'Classic' } = {}) {
  return `<div class="board-stage" data-view="${escapeAttr(view)}" data-flip="${flip ? '1' : '0'}" id="board-stage">
    <div class="board-frame" id="board-frame">
      <canvas class="deep-canvas" id="deep-canvas" aria-hidden="true"></canvas>
      <div class="deep-note" id="deep-note" hidden></div>
      <div class="board-grid" role="grid" aria-label="Chess board, sixty-four squares" id="board-grid"
        data-fen="${escapeAttr(game.fen)}">
        ${renderSquares(game.fen, { flip, set2d, lastMove: game.last_move })}
      </div>
      <div class="board-overlay" id="board-overlay" aria-hidden="true"></div>
    </div>
    <p class="board-hint" id="board-hint">Arrow keys move between squares, Enter picks up and puts down a piece, Escape cancels.</p>
  </div>`;
}

export function renderMoveList(moves) {
  if (!moves.length) {
    return '<p class="empty-state" id="move-list-empty">No moves yet. White begins.</p>';
  }
  let html = '<ol class="move-list" id="move-list">';
  for (let i = 0; i < moves.length; i += 2) {
    const number = i / 2 + 1;
    const white = moves[i];
    const black = moves[i + 1];
    html += `<li class="move-row"><span class="move-number">${number}.</span>
      <span class="move-san" data-ply="${white.ply}">${escapeHtml(white.san)}</span>
      ${black ? `<span class="move-san" data-ply="${black.ply}">${escapeHtml(black.san)}</span>` : '<span class="move-san is-empty"></span>'}
    </li>`;
  }
  return `${html}</ol>`;
}

export function renderPlayerBar(player, { side, toMove, className = '' }) {
  return `<div class="player-bar ${className}" data-side="${side}">
    <img class="player-avatar" src="${escapeAttr(player.avatar_url)}" width="44" height="44" alt="">
    <span class="player-text">
      <strong class="player-name">${escapeHtml(player.username)}</strong>
      <span class="player-rating">${escapeHtml(player.rating_display === null ? 'unrated' : player.rating_display)}</span>
    </span>
    <span class="turn-marker${toMove ? ' is-on' : ''}" data-turn-marker="${side}">
      <span class="turn-dot" aria-hidden="true"></span>
      <span>${toMove ? 'to move' : ''}</span>
    </span>
  </div>`;
}

const REASON_WORDS = {
  checkmate: 'checkmate',
  resignation: 'resignation',
  agreement: 'agreement',
  'threefold claim': 'threefold claim',
  'fifty-move claim': 'fifty-move claim',
  'fivefold repetition': 'fivefold repetition',
  'insufficient material': 'insufficient material',
  stalemate: 'stalemate',
  deadline: 'deadline',
  void: 'void',
};

/** The victory, defeat and draw screens, complete with every word and control. */
export function renderResultScreen(game, viewerSide) {
  if (game.status === 'aborted') {
    return `<div class="result-screen is-draw" id="result-screen" data-outcome="aborted" role="group" aria-label="Game aborted">
      <h2 class="result-heading">Aborted</h2>
      <p class="result-reason">No first move was played, so this game was aborted. No rating moved.</p>
      <div class="result-actions"><a class="button button-quiet" href="/hall">Back to the hall</a></div>
    </div>`;
  }
  if (game.status !== 'finished') return '';

  const reason = REASON_WORDS[game.end_reason] || game.end_reason || '';
  const drawn = game.result === '1/2-1/2';
  let outcome = 'draw';
  let heading = 'Drawn';
  if (!drawn) {
    const winner = game.result === '1-0' ? 'white' : 'black';
    if (viewerSide === 'white' || viewerSide === 'black') {
      outcome = viewerSide === winner ? 'victory' : 'defeat';
      heading = viewerSide === winner ? 'You won' : 'You lost';
    } else {
      outcome = winner === 'white' ? 'white-won' : 'black-won';
      heading = winner === 'white' ? 'White won' : 'Black won';
    }
  }
  const loserSide = drawn ? null : (game.result === '1-0' ? 'black' : 'white');

  return `<div class="result-screen is-${escapeAttr(outcome)}" id="result-screen" data-outcome="${escapeAttr(outcome)}"
      data-reason="${escapeAttr(reason)}" data-loser="${escapeAttr(loserSide || '')}" role="group" aria-label="Result">
    <h2 class="result-heading">${escapeHtml(heading)}</h2>
    <p class="result-reason">${drawn ? `Drawn by <strong>${escapeHtml(reason)}</strong>.` : `By <strong>${escapeHtml(reason)}</strong>. The result is ${escapeHtml(game.result)}.`}</p>
    <p class="result-rating">${game.rated ? 'This game was rated.' : 'This game moved no rating.'}</p>
    <div class="result-actions">
      <button type="button" class="button button-primary" data-action="rematch">Rematch</button>
      <a class="button button-quiet" href="/hall">Back to the hall</a>
      <a class="button button-quiet" href="/game/${escapeAttr(game.id)}/record">Game record</a>
    </div>
  </div>`;
}

export function renderChatPanel(messages, { isPlayer, viewer }) {
  if (!isPlayer) {
    return `<div class="chat-panel" id="chat-panel" data-chat="closed">
      <p class="chat-closed">A game's chat is for its two players. You are watching this game, so the chat is closed to you.</p>
    </div>`;
  }
  const list = messages.length
    ? messages.map((message) => renderChatMessage(message, viewer)).join('')
    : '<li class="chat-empty">No messages yet. Say hello.</li>';
  return `<div class="chat-panel" id="chat-panel" data-chat="open">
    <ul class="chat-list" id="chat-list" aria-live="polite">${list}</ul>
    <form class="chat-form" id="chat-form">
      <label class="chat-label" for="chat-input">Message</label>
      <div class="chat-row">
        <input id="chat-input" name="text" type="text" maxlength="500" autocomplete="off" required>
        <button type="submit" class="button button-primary">Send</button>
      </div>
      <p class="field-error" id="chat-error" role="alert"></p>
    </form>
  </div>`;
}

export function renderChatMessage(message, viewer) {
  const mine = viewer && message.username === viewer.username;
  return `<li class="chat-message${mine ? ' is-mine' : ''}" data-message-id="${escapeAttr(message.id)}">
    <img class="chat-avatar" src="${escapeAttr(message.avatar_url)}" width="28" height="28" alt="">
    <div class="chat-body">
      <span class="chat-author">${escapeHtml(message.username)}</span>
      <p class="chat-text">${escapeHtml(message.text)}</p>
    </div>
  </li>`;
}

export function renderGameControls(game, { isPlayer }) {
  if (!isPlayer) {
    return `<div class="game-controls" id="game-controls" data-controls="spectator">
      <p class="controls-note">You are watching this game. Only its two players may act in it.</p>
    </div>`;
  }
  const over = game.status !== 'in_progress';
  const disabled = over ? ' disabled' : '';
  return `<div class="game-controls" id="game-controls" data-controls="player">
    <button type="button" class="button button-quiet" data-action="draw-offer"${disabled}>${icon('equals')}<span>Offer draw</span></button>
    <button type="button" class="button button-quiet" data-action="claim"${disabled}>${icon('equals')}<span>Claim draw</span></button>
    <button type="button" class="button button-quiet" data-action="takeback"${disabled}>${icon('takeback')}<span>Ask for takeback</span></button>
    <button type="button" class="button button-danger" data-action="resign"${disabled}>${icon('flag')}<span>Resign</span></button>
    <button type="button" class="button button-primary" data-action="rematch"${over ? '' : ' disabled'}>${icon('challenge')}<span>Rematch</span></button>
    <div class="claim-chooser" id="claim-chooser" hidden>
      <p id="claim-chooser-label">Which draw do you claim?</p>
      <div class="claim-row" role="group" aria-labelledby="claim-chooser-label">
        <button type="button" class="button button-quiet" data-claim="threefold">Threefold repetition</button>
        <button type="button" class="button button-quiet" data-claim="fifty-move">Fifty-move rule</button>
      </div>
    </div>
  </div>`;
}

export function renderOfferPanel(game, { isPlayer, viewer }) {
  const rows = [];
  if (game.draw_offer_by) {
    const mine = viewer && game.draw_offer_by === viewer.username;
    rows.push(`<div class="offer-row" data-offer="draw">
      <p>${mine ? 'You have offered a draw. Waiting for an answer.' : `${escapeHtml(game.draw_offer_by)} offers a draw.`}</p>
      ${!mine && isPlayer ? `<div class="offer-actions">
        <button type="button" class="button button-primary" data-action="draw-accept">Accept</button>
        <button type="button" class="button button-quiet" data-action="draw-decline">Decline</button>
      </div>` : ''}
    </div>`);
  }
  if (game.takeback_by) {
    const mine = viewer && game.takeback_by === viewer.username;
    rows.push(`<div class="offer-row" data-offer="takeback">
      <p>${mine ? 'You have asked for a takeback. Waiting for an answer.' : `${escapeHtml(game.takeback_by)} asks for a takeback.`}</p>
      ${!mine && isPlayer ? `<div class="offer-actions">
        <button type="button" class="button button-primary" data-action="takeback-accept">Accept</button>
        <button type="button" class="button button-quiet" data-action="takeback-decline">Decline</button>
      </div>` : ''}
    </div>`);
  }
  return `<div class="offer-panel" id="offer-panel"${rows.length ? '' : ' hidden'}>${rows.join('')}</div>`;
}

export function renderPromotionDialog() {
  return `<div class="dialog-backdrop" id="promotion-dialog" hidden>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
      <h2 class="dialog-heading" id="promotion-title">Promote your pawn</h2>
      <div class="promotion-row">
        <button type="button" class="button button-quiet" data-promote="q">Queen</button>
        <button type="button" class="button button-quiet" data-promote="r">Rook</button>
        <button type="button" class="button button-quiet" data-promote="b">Bishop</button>
        <button type="button" class="button button-quiet" data-promote="n">Knight</button>
      </div>
      <button type="button" class="button button-quiet dialog-cancel" data-promote-cancel>Cancel</button>
    </div>
  </div>`;
}

export { FILES, pieceLabel };
