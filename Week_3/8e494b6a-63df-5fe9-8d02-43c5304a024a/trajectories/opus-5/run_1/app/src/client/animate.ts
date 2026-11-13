export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Keyframes = Keyframe[];

/** Under reduced motion no animation is ever created, so getAnimations() stays empty. */
function run(node: Element, keyframes: Keyframes, options: KeyframeAnimationOptions, id: string): Animation | null {
  if (reducedMotion()) return null;
  const animation = node.animate(keyframes, options);
  animation.id = id;
  return animation;
}

const FAST_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const EVEN = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function barSettle(node: Element, fromHeight: string, toHeight: string): void {
  run(node, [{ height: fromHeight }, { height: toHeight }], { duration: 200, easing: FAST_OUT }, 'bar-settle');
}

export function panelIn(node: Element): void {
  run(
    node,
    [
      { transform: 'translateX(16px)', opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: 160, easing: FAST_OUT },
    'panel-in',
  );
}

export function sheetRise(node: Element): void {
  run(
    node,
    [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
    { duration: 240, easing: EVEN },
    'sheet-rise',
  );
}

export function tabSlide(node: Element, fromLeft: number, toLeft: number, width: number): void {
  run(
    node,
    [
      { transform: `translateX(${fromLeft}px)`, width: `${width}px` },
      { transform: `translateX(${toLeft}px)`, width: `${width}px` },
    ],
    { duration: 240, easing: FAST_OUT },
    'tab-slide',
  );
}

export function springBack(node: HTMLElement): void {
  if (reducedMotion()) {
    node.style.transform = 'translateX(0)';
    return;
  }
  const animation = node.animate(
    [{ transform: node.style.transform || 'translateX(0)' }, { transform: 'translateX(0)' }],
    { duration: 200, easing: EVEN },
  );
  animation.id = 'swipe-spring';
  animation.addEventListener('finish', () => {
    node.style.transform = 'translateX(0)';
  });
}
