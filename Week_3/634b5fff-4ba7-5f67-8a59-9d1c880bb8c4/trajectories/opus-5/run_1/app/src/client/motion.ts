export type MotionName =
  | 'press'
  | 'focus'
  | 'shake'
  | 'count'
  | 'step'
  | 'payment-state'
  | 'receipt'
  | 'row'
  | 'route';

/** One curve for every interface motion: fast away, soft to rest. */
const CURVE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const lengths: Record<MotionName, number> = {
  press: 120,
  focus: 160,
  shake: 240,
  count: 320,
  step: 420,
  'payment-state': 320,
  receipt: 480,
  row: 180,
  route: 480,
};

const frames: Record<MotionName, Keyframe[]> = {
  press: [{ transform: 'scale(1)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
  focus: [{ outlineOffset: '6px' }, { outlineOffset: '2px' }],
  shake: [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ],
  count: [
    { transform: 'translateY(0)', opacity: '1' },
    { transform: 'translateY(-60%)', opacity: '0' },
    { transform: 'translateY(60%)', opacity: '0' },
    { transform: 'translateY(0)', opacity: '1' },
  ],
  step: [
    { transform: 'translateX(16px)', opacity: '0' },
    { transform: 'translateX(0)', opacity: '1' },
  ],
  'payment-state': [{ opacity: '0' }, { opacity: '1' }],
  receipt: [
    { transform: 'scaleY(0.6)', transformOrigin: 'top', opacity: '0' },
    { transform: 'scaleY(1)', transformOrigin: 'top', opacity: '1' },
  ],
  row: [
    { transform: 'translateY(6px)', opacity: '0' },
    { transform: 'translateY(0)', opacity: '1' },
  ],
  route: [{ opacity: '0' }, { opacity: '1' }],
};

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function runMotion(element: Element, name: MotionName, order = 0): void {
  element.setAttribute('data-motion', name);
  const instant = reducedMotion();
  const stagger = name === 'row' ? Math.min(order, 9) * 30 : 0;
  element.animate(frames[name], {
    duration: instant ? 0 : lengths[name],
    delay: instant ? 0 : stagger,
    easing: CURVE,
    fill: 'forwards',
  });
}

export function markMotion(element: Element, name: MotionName): void {
  element.setAttribute('data-motion', name);
}

/** Names the motion each control uses, so it is readable before it runs. */
export function markTree(root: ParentNode): void {
  for (const node of root.querySelectorAll('button')) markMotion(node, 'press');
  for (const node of root.querySelectorAll('input, textarea')) markMotion(node, 'focus');
  for (const node of root.querySelectorAll('form')) markMotion(node, 'shake');
}
