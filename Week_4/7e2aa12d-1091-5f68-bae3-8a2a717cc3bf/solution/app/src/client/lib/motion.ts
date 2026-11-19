type Motion = 'drawer' | 'notice' | 'fold';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Play one of the three motions the brief allows, using the duration and easing tokens from the stylesheet.
 * With reduced motion nothing plays and `done` runs at once.
 */
export function play(element: Element, motion: Motion, keyframes: Keyframe[], done?: () => void): void {
  if (reducedMotion()) {
    done?.();
    return;
  }
  const animation = element.animate(keyframes, {
    duration: Number.parseFloat(token(`--motion-${motion}`)),
    easing: token('--motion-easing'),
    fill: 'both',
  });
  if (done) animation.addEventListener('finish', done, { once: true });
}
