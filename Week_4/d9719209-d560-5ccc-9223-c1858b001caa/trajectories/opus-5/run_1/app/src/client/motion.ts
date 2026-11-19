import { reducedMotion } from './dom.js';

const SCORE_ROLL_MS = 200;
const GLOW_MS = 1200;
const FOLD_MS = 450;

/**
 * Score digits roll by one line, or change instantly with reduced motion. The element keeps the
 * text it should end on, so a rollback that arrives mid-roll still wins.
 */
export function rollScore(element: HTMLElement, text: string): void {
  if (element.dataset.rolling === text || (element.dataset.rolling === undefined && element.textContent === text)) {
    element.dataset.rolling = text;
    return;
  }
  element.dataset.rolling = text;
  if (reducedMotion()) {
    element.textContent = text;
    return;
  }
  const previous = element.textContent ?? '';
  const direction = Number(text.replace(/[^\d-]/g, '')) >= Number(previous.replace(/[^\d-]/g, '')) ? -1 : 1;
  element.animate(
    [
      { transform: 'translateY(0)', opacity: '1' },
      { transform: `translateY(${direction * 0.8}em)`, opacity: '0' },
    ],
    { duration: SCORE_ROLL_MS / 2, easing: 'ease-out' },
  ).onfinish = () => {
    element.textContent = element.dataset.rolling ?? text;
    element.animate(
      [
        { transform: `translateY(${-direction * 0.8}em)`, opacity: '0' },
        { transform: 'translateY(0)', opacity: '1' },
      ],
      { duration: SCORE_ROLL_MS / 2, easing: 'ease-out' },
    );
  };
}

export function glowRail(comment: Element): void {
  const rail = comment.querySelector('.fold-rail');
  if (!rail) return;
  if (reducedMotion()) return;
  rail.classList.add('is-glowing');
  window.setTimeout(() => rail.classList.remove('is-glowing'), GLOW_MS);
}

/** A new comment grows into place; with reduced motion it carries a static New tag instead. */
export function growIn(item: HTMLElement): void {
  if (reducedMotion()) {
    const tag = document.createElement('span');
    tag.className = 'new-tag';
    tag.textContent = 'New';
    item.querySelector('.comment-author-line')?.append(tag);
    const clear = () => tag.remove();
    item.addEventListener('focusin', clear, { once: true });
    window.addEventListener('scroll', clear, { once: true });
    return;
  }
  item.animate(
    [
      { transform: 'scaleY(0.9)', opacity: '0' },
      { transform: 'scaleY(1)', opacity: '1' },
    ],
    { duration: 320, easing: 'ease-out' },
  );
}

export interface FoldSequence {
  content: HTMLElement;
  rail: HTMLElement | null;
  pill: HTMLElement;
}

/**
 * The signature fold: the reply block shrinks and fades, the rail retracts, then the header
 * compacts into the pill. Elements only move, scale and fade, and the whole run stays under half a
 * second. Reduced motion performs the same steps instantly. The pill is in the page before the
 * sequence starts, so focus can move to it at once.
 */
export function foldSequence(parts: FoldSequence, folding: boolean): void {
  const { content, rail, pill } = parts;
  if (reducedMotion()) {
    content.hidden = folding;
    pill.hidden = !folding;
    return;
  }

  if (folding) {
    const height = content.getBoundingClientRect().height;
    const animation = content.animate(
      [
        { transform: 'scaleY(1)', opacity: '1', maxHeight: `${height}px` },
        { transform: 'scaleY(0.6)', opacity: '0', maxHeight: '0px' },
      ],
      { duration: FOLD_MS * 0.55, easing: 'ease-in' },
    );
    rail?.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], {
      duration: FOLD_MS * 0.3,
      delay: FOLD_MS * 0.45,
      easing: 'ease-in',
      fill: 'forwards',
    });
    animation.onfinish = () => {
      content.hidden = true;
      pill.animate(
        [
          { transform: 'translateY(-4px)', opacity: '0' },
          { transform: 'translateY(0)', opacity: '1' },
        ],
        { duration: FOLD_MS * 0.25, easing: 'ease-out' },
      );
    };
    return;
  }

  pill.hidden = true;
  content.hidden = false;
  const height = content.getBoundingClientRect().height;
  content.animate(
    [
      { transform: 'scaleY(0.6)', opacity: '0', maxHeight: '0px' },
      { transform: 'scaleY(1)', opacity: '1', maxHeight: `${height}px` },
    ],
    { duration: FOLD_MS * 0.55, easing: 'ease-out' },
  );
  rail?.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
    duration: FOLD_MS * 0.3,
    easing: 'ease-out',
  });
}

export function dialogEnter(dialog: HTMLElement): void {
  if (reducedMotion()) return;
  dialog.animate(
    [
      { transform: 'translateY(8px)', opacity: '0' },
      { transform: 'translateY(0)', opacity: '1' },
    ],
    { duration: 200, easing: 'ease-out' },
  );
}
