/** The Hand-off glide: a card that moved travels from where it was on screen to where it now belongs. */

const GLIDE_MS = 320;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

type Rects = Map<string, DOMRect>;

const running = new Map<string, Animation>();

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Drops every running glide (sign-out and board changes). */
export function resetGlide(): void {
  for (const animation of running.values()) animation.cancel();
  running.clear();
}

/** Where every card is on screen right now, in-flight glides included; running glides are cancelled so the new layout is measured clean. */
export function captureRects(): Rects {
  const rects: Rects = new Map();
  for (const item of document.querySelectorAll<HTMLElement>('[data-card-item]')) {
    rects.set(item.dataset['cardItem'] ?? '', item.getBoundingClientRect());
  }
  resetGlide();
  return rects;
}

/** Animates every card that is somewhere new from where `before` had it; reduced motion jumps instead. */
export function playGlide(before: Rects): void {
  if (prefersReducedMotion()) return;
  for (const item of document.querySelectorAll<HTMLElement>('[data-card-item]')) {
    const id = item.dataset['cardItem'] ?? '';
    const first = before.get(id);
    if (!first) continue;
    const last = item.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    item.style.zIndex = '2';
    const animation = item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASING });
    running.set(id, animation);
    animation.onfinish = () => {
      if (running.get(id) === animation) running.delete(id);
      item.style.zIndex = '';
    };
    animation.oncancel = () => {
      item.style.zIndex = '';
    };
  }
}
