/**
 * The six game animations, plus the check pulse.  Each one is a Web Animation
 * on a page element, so it is listed by document.getAnimations() while it
 * runs, and each lasts between 150 and 1200 milliseconds.  Under reduced
 * motion every one becomes instant and nothing is lost: the end state is the
 * state the page keeps.
 */

import { pieceSvg } from './pieces.js';
import { reducedMotion } from './app.js';

export const DURATIONS = {
  move: 320,
  capture: 300,
  promotion: 420,
  victory: 900,
  defeat: 800,
  draw: 700,
};

const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

function timing(kind, extra = {}) {
  return {
    duration: reducedMotion() ? 1 : DURATIONS[kind],
    easing: EASE,
    fill: 'forwards',
    ...extra,
    delay: reducedMotion() ? 0 : (extra.delay || 0),
  };
}

/**
 * Play one animation.  Under reduced motion only the final state is used, so
 * nothing moves and nothing is lost: the page lands where it would have ended.
 */
function run(element, frames, kind, extra = {}) {
  const final = frames[frames.length - 1];
  const used = reducedMotion() ? [final, final] : frames;
  return element.animate(used, timing(kind, extra));
}

function boxWithin(container, element) {
  const outer = container.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  return {
    left: inner.left - outer.left,
    top: inner.top - outer.top,
    width: inner.width,
    height: inner.height,
  };
}

function flyPiece(container, box, pieceChar, setName) {
  const node = document.createElement('div');
  node.className = 'fly-piece';
  node.style.left = `${box.left}px`;
  node.style.top = `${box.top}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
  node.innerHTML = pieceSvg(setName, pieceChar);
  container.appendChild(node);
  return node;
}

/** A piece travels from its old square to its new one; a knight arcs. */
export function animateMove(container, fromSquare, toSquare, pieceChar, setName) {
  if (!container || !fromSquare || !toSquare) return null;
  const from = boxWithin(container, fromSquare);
  const to = boxWithin(container, toSquare);
  const node = flyPiece(container, from, pieceChar, setName);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const isKnight = String(pieceChar).toLowerCase() === 'n';
  const frames = isKnight
    ? [
      { transform: 'translate(0px, 0px)', offset: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - from.height * 0.55}px)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px)`, offset: 1 },
    ]
    : [
      { transform: 'translate(0px, 0px)' },
      { transform: `translate(${dx}px, ${dy}px)` },
    ];
  const animation = run(node, frames, 'move');
  animation.finished.then(() => node.remove()).catch(() => node.remove());
  return animation;
}

/** A taken piece fades out while growing past its size. */
export function animateCapture(container, squareElement, pieceChar, setName) {
  if (!container || !squareElement) return null;
  const box = boxWithin(container, squareElement);
  const node = flyPiece(container, box, pieceChar, setName);
  const animation = run(node, [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0.6, transform: 'scale(1.45)', offset: 0.6 },
    { opacity: 0, transform: 'scale(1.75)' },
  ], 'capture');
  animation.finished.then(() => node.remove()).catch(() => node.remove());
  return animation;
}

/** A promoted piece grows past its size and settles back. */
export function animatePromotion(squareElement) {
  const target = squareElement?.querySelector('.sq-piece');
  if (!target) return null;
  return run(target, [
    { transform: 'scale(0.55)', opacity: 0.4 },
    { transform: 'scale(1.35)', opacity: 1, offset: 0.65 },
    { transform: 'scale(1)', opacity: 1 },
  ], 'promotion');
}

/** A victory raises the winning king in a scatter of marks that fade as they fly. */
export function animateVictory(container, kingSquare, resultScreen) {
  const animations = [];
  const piece = kingSquare?.querySelector('.sq-piece');
  if (piece) {
    animations.push(run(piece, [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-26%) scale(1.14)', offset: 0.55 },
      { transform: 'translateY(-16%) scale(1.08)' },
    ], 'victory'));
  }
  if (container && kingSquare) {
    const box = boxWithin(container, kingSquare);
    for (let i = 0; i < 12; i++) {
      const spark = document.createElement('div');
      spark.className = 'spark';
      spark.style.left = `${box.left + box.width / 2 - 5}px`;
      spark.style.top = `${box.top + box.height / 2 - 5}px`;
      container.appendChild(spark);
      const angle = (i / 12) * Math.PI * 2;
      const distance = box.width * (1.1 + (i % 3) * 0.3);
      const animation = run(spark, [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px) scale(0.3)`,
          opacity: 0,
        },
      ], 'victory', { delay: i * 12 });
      animation.finished.then(() => spark.remove()).catch(() => spark.remove());
      animations.push(animation);
    }
  }
  if (resultScreen) animations.push(fadeUp(resultScreen, 'victory'));
  return animations[0] || null;
}

/** A defeat topples the losing king and rests it at an angle. */
export function animateDefeat(kingSquare, resultScreen) {
  const piece = kingSquare?.querySelector('.sq-piece');
  let animation = null;
  if (piece) {
    piece.style.transformOrigin = '50% 85%';
    animation = run(piece, [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(74deg)', offset: 0.78 },
      { transform: 'rotate(68deg)' },
    ], 'defeat');
    // The king rests at the fall angle for as long as the game is open.
    animation.finished.then(() => { piece.style.transform = 'rotate(68deg)'; }).catch(() => {});
  }
  if (resultScreen) fadeUp(resultScreen, 'defeat');
  return animation;
}

/** A draw settles both kings level with each other while the screen fades up. */
export function animateDraw(whiteKingSquare, blackKingSquare, resultScreen) {
  const animations = [];
  for (const square of [whiteKingSquare, blackKingSquare]) {
    const piece = square?.querySelector('.sq-piece');
    if (!piece) continue;
    animations.push(run(piece, [
      { transform: 'translateY(0) rotate(0deg)' },
      { transform: 'translateY(-14%) rotate(-4deg)', offset: 0.45 },
      { transform: 'translateY(0) rotate(0deg)' },
    ], 'draw'));
  }
  if (resultScreen) animations.push(fadeUp(resultScreen, 'draw'));
  return animations[0] || null;
}

function fadeUp(element, kind) {
  return run(element, [
    { opacity: 0, transform: 'translateY(12px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], kind);
}

/** The six, by name, for whatever ends the game. */
export function animateOutcome({ outcome, container, winnerKing, loserKing, whiteKing, blackKing, resultScreen }) {
  if (outcome === 'victory') return animateVictory(container, winnerKing, resultScreen);
  if (outcome === 'defeat') return animateDefeat(loserKing, resultScreen);
  if (outcome === 'draw') return animateDraw(whiteKing, blackKing, resultScreen);
  if (outcome === 'white-won' || outcome === 'black-won') {
    animateVictory(container, winnerKing, resultScreen);
    return animateDefeat(loserKing, null);
  }
  return null;
}
