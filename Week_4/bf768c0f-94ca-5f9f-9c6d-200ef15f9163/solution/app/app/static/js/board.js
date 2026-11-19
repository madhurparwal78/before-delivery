// The flat board and the sixty-four-square grid: one position, two drawings.
import { reducedMotion } from './app.js';

export const FILES = 'abcdefgh';
export const PIECE_WORD = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King' };
const COLOUR_WORD = { w: 'White', b: 'Black' };

export function piecesFromFen(fen) {
  const map = {};
  const placement = fen.split(' ')[0];
  let rank = 8;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') { rank -= 1; file = 0; continue; }
    if (/\d/.test(ch)) { file += Number(ch); continue; }
    const colour = ch === ch.toUpperCase() ? 'w' : 'b';
    map[`${FILES[file]}${rank}`] = colour + ch.toUpperCase();
    file += 1;
  }
  return map;
}

export function turnFromFen(fen) {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

export function squareOrder(orientation) {
  const ranks = orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const out = [];
  ranks.forEach((rank) => files.forEach((file) => out.push(`${FILES[file]}${rank}`)));
  return out;
}

export function isLight(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 1;
}

export function squareLabel(square, piece) {
  if (!piece) return square;
  return `${square}, ${COLOUR_WORD[piece[0]]} ${PIECE_WORD[piece[1]]}`;
}

function pieceSvg(piece, setSlug) {
  return `<svg class="piece" viewBox="0 0 45 45" data-colour="${piece[0]}" data-kind="${piece[1]}">`
    + `<use href="#pc-${setSlug}-${piece[1]}"></use></svg>`;
}

export function currentSetSlug() {
  return document.documentElement.dataset.set2d || 'classic';
}

export function kingSquare(pieces, colour) {
  return Object.keys(pieces).find((sq) => pieces[sq] === `${colour[0]}K`) || null;
}

export class FlatBoard {
  constructor(element, orientation, onSquare) {
    this.element = element;
    this.orientation = orientation;
    this.onSquare = onSquare;
    this.element.addEventListener('click', (event) => {
      const square = event.target.closest('[data-square]');
      if (square) this.onSquare(square.dataset.square);
    });
  }

  render(state) {
    const { pieces, selected, legal, lastMove, check, toppled } = state;
    const order = squareOrder(this.orientation);
    const setSlug = currentSetSlug();
    this.element.innerHTML = order.map((square, index) => {
      const piece = pieces[square];
      const classes = ['sq'];
      if (!isLight(square)) classes.push('dark');
      if (selected === square) classes.push('selected');
      if (legal && legal.has(square)) { classes.push('legal'); if (piece) classes.push('occupied'); }
      if (lastMove && (lastMove.slice(0, 2) === square || lastMove.slice(2, 4) === square)) classes.push('last-move');
      if (check === square) classes.push('in-check');
      if (toppled === square) classes.push('toppled');
      const rank = square[1];
      const coordRank = index % 8 === 0 ? `<span class="coord-rank">${rank}</span>` : '';
      const coordFile = index >= 56 ? `<span class="coord-file">${square[0]}</span>` : '';
      return `<div class="${classes.join(' ')}" data-square="${square}">${coordRank}${coordFile}`
        + `${piece ? pieceSvg(piece, setSlug) : ''}</div>`;
    }).join('');
  }

  squareElement(square) {
    return this.element.querySelector(`[data-square="${square}"]`);
  }

  // A piece travels from its old square to its new one; a knight arcs.
  async animateMove(from, to, { knight = false, capture = false } = {}) {
    const fromEl = this.squareElement(from);
    const toEl = this.squareElement(to);
    if (!fromEl || !toEl) return;
    const piece = fromEl.querySelector('.piece');
    if (!piece) return;
    const duration = reducedMotion() ? 1 : 300;
    const boardRect = this.element.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const clone = piece.cloneNode(true);
    clone.classList.add('flying-piece');
    clone.style.width = `${a.width * 0.88}px`;
    clone.style.height = `${a.height * 0.88}px`;
    clone.style.left = `${a.left - boardRect.left + a.width * 0.06}px`;
    clone.style.top = `${a.top - boardRect.top + a.height * 0.06}px`;
    this.element.appendChild(clone);
    piece.style.visibility = 'hidden';
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    const frames = knight
      ? [{ transform: 'translate(0,0)' },
         { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - a.height * 0.55}px)` },
         { transform: `translate(${dx}px, ${dy}px)` }]
      : [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, ${dy}px)` }];
    if (capture) {
      const taken = toEl.querySelector('.piece');
      if (taken) {
        taken.animate(
          [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5) rotate(12deg)' }],
          { duration: reducedMotion() ? 1 : 320, easing: 'ease-out', fill: 'forwards' },
        );
      }
    }
    await clone.animate(frames, {
      duration, easing: 'cubic-bezier(0.3, 0.1, 0.25, 1)', fill: 'forwards',
    }).finished.catch(() => {});
    clone.remove();
  }

  popPromotion(square) {
    const piece = this.squareElement(square)?.querySelector('.piece');
    if (!piece) return;
    piece.animate(
      [{ transform: 'scale(0.4)', opacity: 0.3 }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
      { duration: reducedMotion() ? 1 : 420, easing: 'cubic-bezier(0.2, 1.3, 0.4, 1)' },
    );
  }
}

export class SquareGrid {
  constructor(element, orientation, onSquare) {
    this.element = element;
    this.orientation = orientation;
    this.onSquare = onSquare;
    this.focusIndex = 0;
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-square]');
      if (button) {
        this.focusIndex = this.buttons().indexOf(button);
        this.onSquare(button.dataset.square);
      }
    });
    this.element.addEventListener('keydown', (event) => this.onKey(event));
  }

  buttons() {
    return Array.from(this.element.querySelectorAll('button[data-square]'));
  }

  onKey(event) {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 };
    if (event.key in keys) {
      event.preventDefault();
      const next = Math.min(63, Math.max(0, this.focusIndex + keys[event.key]));
      this.focusIndex = next;
      this.setRoving();
      this.buttons()[next].focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.focusIndex = event.key === 'Home' ? 0 : 63;
      this.setRoving();
      this.buttons()[this.focusIndex].focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // The focused square, however focus reached it; the roving index follows it.
      const button = event.target.closest('button[data-square]') || this.buttons()[this.focusIndex];
      if (button) { this.focusIndex = this.buttons().indexOf(button); this.onSquare(button.dataset.square); }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onSquare(null);
    }
  }

  setRoving() {
    this.buttons().forEach((button, index) => {
      button.tabIndex = index === this.focusIndex ? 0 : -1;
    });
  }

  render(state) {
    const { pieces, selected, legal } = state;
    const order = squareOrder(this.orientation);
    const focused = document.activeElement && this.element.contains(document.activeElement);
    const setSlug = currentSetSlug();
    this.element.innerHTML = order.map((square, index) => {
      const piece = pieces[square];
      const classes = ['sqb'];
      if (legal && legal.has(square)) classes.push('legal');
      return `<button type="button" class="${classes.join(' ')}" data-square="${square}"`
        + ` data-light="${isLight(square) ? 1 : 0}" aria-pressed="${selected === square}"`
        + ` aria-label="${squareLabel(square, piece)}" tabindex="${index === this.focusIndex ? 0 : -1}">`
        + `<span class="sq-name">${square}</span>`
        + `<span class="occupant" aria-hidden="true">${piece ? pieceSvg(piece, setSlug) : ''}</span></button>`;
    }).join('');
    if (focused) this.buttons()[this.focusIndex]?.focus();
  }
}
