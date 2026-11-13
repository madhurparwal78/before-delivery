export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Runs a named motion, or jumps to its end state under reduced motion. */
export function run(
  element: HTMLElement,
  id: 'sheet-open' | 'gallery-slide' | 'night-expand',
  keyframes: Keyframe[],
  duration: number,
): Animation | null {
  if (reducedMotion()) return null;
  const animation = element.animate(keyframes, {
    duration,
    easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
    fill: 'none',
  });
  animation.id = id;
  return animation;
}

export function sheetOpen(element: HTMLElement): void {
  run(element, 'sheet-open', [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], 240);
}

export function gallerySlide(element: HTMLElement, forward: boolean): void {
  const from = forward ? '40%' : '-40%';
  run(element, 'gallery-slide', [
    { transform: `translateX(${from})`, opacity: '0.4' },
    { transform: 'translateX(0)', opacity: '1' },
  ], 240);
}

export function nightExpand(element: HTMLElement): void {
  run(element, 'night-expand', [{ transform: 'scaleX(0.6)' }, { transform: 'scaleX(1)' }], 320);
}
