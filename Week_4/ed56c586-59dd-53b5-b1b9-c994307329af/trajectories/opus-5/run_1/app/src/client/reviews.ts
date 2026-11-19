/** The review carousel: buttons, arrow keys and a horizontal drag. */

import { REVIEWS } from '../shared/seed.js';
import { reviewAnnouncement } from '../shared/text.js';
import { announce, need, queryAll } from './dom.js';

const SWIPE_MIN_PX = 40;

export const setUpReviews = (): void => {
  const carousel = need<HTMLElement>('[data-carousel]');
  const track = need<HTMLElement>('[data-review-track]', carousel);
  const slides = queryAll<HTMLElement>('[data-review]', track);
  const position = need<HTMLElement>('[data-review-position]', carousel);
  const previousButton = need<HTMLButtonElement>('[data-review-previous]', carousel);
  const nextButton = need<HTMLButtonElement>('[data-review-next]', carousel);
  const total = slides.length;

  let shown = 1;

  const paint = (next: number): void => {
    if (next < 1 || next > total || next === shown) return;
    shown = next;
    track.style.setProperty('--review-index', String(shown - 1));
    for (const slide of slides) {
      const isShown = slide.dataset.review === String(shown);
      slide.dataset.shown = isShown ? 'true' : 'false';
      if (isShown) {
        slide.removeAttribute('aria-hidden');
        slide.removeAttribute('inert');
      } else {
        slide.setAttribute('aria-hidden', 'true');
        slide.setAttribute('inert', '');
      }
    }
    position.textContent = `${shown} / ${total}`;
    // Disabling the focused button blurs it, so its identity is read first.
    const wasFocused = document.activeElement;
    previousButton.disabled = shown === 1;
    nextButton.disabled = shown === total;
    if (previousButton.disabled && wasFocused === previousButton) {
      nextButton.focus({ preventScroll: true });
    }
    if (nextButton.disabled && wasFocused === nextButton) {
      previousButton.focus({ preventScroll: true });
    }
    const review = REVIEWS[shown - 1];
    if (review !== undefined) announce(reviewAnnouncement(shown, review));
  };

  previousButton.addEventListener('click', () => paint(shown - 1));
  nextButton.addEventListener('click', () => paint(shown + 1));

  carousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') paint(shown + 1);
    else if (event.key === 'ArrowLeft') paint(shown - 1);
    else if (event.key === 'Home') paint(1);
    else if (event.key === 'End') paint(total);
    else return;
    event.preventDefault();
  });

  let startX: number | null = null;
  let startY = 0;

  track.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    // A mouse drag may end outside the track, so the track keeps the pointer.
    if (event.pointerType === 'mouse') track.setPointerCapture(event.pointerId);
  });
  track.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    startX = null;
    if (Math.abs(deltaX) < SWIPE_MIN_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    paint(deltaX < 0 ? shown + 1 : shown - 1);
  });
  track.addEventListener('pointercancel', () => {
    startX = null;
  });
};
