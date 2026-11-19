export const EASE_OUT_STRONG = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const SERVICE_MS = 320;
export const CARRY_MS = 480;
export const NEIGHBOUR_MS = 360;
export const TITLE_LINE_MS = 180;
export const TITLE_LINE_STAGGER_MS = 60;
export const FILTER_FADE_MS = 250;
export const COUNT_MS = 1200;

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export const reduced = (): boolean => reduceQuery.matches;

export const animate = (
  element: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null => {
  if (reduced()) return null;
  return element.animate(frames, { fill: 'none', ...options });
};

export function raiseTitleLines(root: ParentNode): void {
  if (reduced()) return;
  const lines = [...root.querySelectorAll<HTMLElement>('[data-title-line]')];
  lines.forEach((line, index) => {
    line.animate(
      [
        { transform: 'translateY(24px)', opacity: '0' },
        { transform: 'translateY(0)', opacity: '1' },
      ],
      {
        duration: TITLE_LINE_MS,
        delay: index * TITLE_LINE_STAGGER_MS,
        easing: EASE_OUT,
        fill: 'backwards',
      },
    );
  });
}
