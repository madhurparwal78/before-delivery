import { on, qs, qsa } from './dom.js';

const SWIPE_FRACTION = 0.25;

function show(gallery: HTMLElement, index: number): void {
  const images = qsa<HTMLElement>('.gallery-image', gallery);
  if (images.length === 0) return;
  const next = Math.max(0, Math.min(images.length - 1, index));
  images.forEach((image, position) => {
    image.hidden = position !== next;
  });
  gallery.dataset.index = String(next);
  const counter = qs<HTMLElement>('#gallery-counter', gallery);
  if (counter) counter.textContent = `Image ${next + 1} of ${images.length}`;
}

function step(gallery: HTMLElement, delta: number): void {
  show(gallery, Number(gallery.dataset.index ?? '0') + delta);
}

/** Revealing a spoiler shows every image of that post for the rest of the page view. */
function revealSpoilers(): void {
  for (const element of qsa<HTMLElement>('.is-spoiler')) element.classList.remove('is-spoiler');
  for (const cover of qsa<HTMLElement>('.spoiler-cover')) cover.remove();
}

export function initGallery(): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-show-spoiler]')) {
      event.preventDefault();
      revealSpoilers();
      return;
    }
    const next = target?.closest<HTMLElement>('[data-gallery-next]');
    const previous = target?.closest<HTMLElement>('[data-gallery-previous]');
    const gallery = (next ?? previous)?.closest<HTMLElement>('[data-gallery]');
    if (gallery) step(gallery, next ? 1 : -1);
  });

  on(document, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const target = keyboard.target as HTMLElement | null;
    const gallery = target?.closest<HTMLElement>('[data-gallery]');
    if (!gallery || (keyboard.key !== 'ArrowRight' && keyboard.key !== 'ArrowLeft')) return;
    keyboard.preventDefault();
    step(gallery, keyboard.key === 'ArrowRight' ? 1 : -1);
  });

  for (const gallery of qsa<HTMLElement>('[data-gallery]')) {
    gallery.dataset.index = '0';
    let startX = 0;
    on(gallery, 'touchstart', (event) => {
      startX = (event as unknown as TouchEvent).changedTouches[0].clientX;
    });
    on(gallery, 'touchend', (event) => {
      const endX = (event as unknown as TouchEvent).changedTouches[0].clientX;
      const distance = endX - startX;
      if (Math.abs(distance) > gallery.getBoundingClientRect().width * SWIPE_FRACTION) {
        step(gallery, distance < 0 ? 1 : -1);
      }
    });
  }
}
