/**
 * The page clock contract: state is written synchronously before any motion
 * starts, and motion only reads `performance.now()`. Nothing here is awaited.
 */
const P1 = { x: 0.2, y: 0 };
const P2 = { x: 0, y: 1 };

function curve(u: number, a: number, b: number): number {
  const v = 1 - u;
  return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
}

export function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 60; i += 1) {
    const x = curve(u, P1.x, P2.x);
    if (x < t) low = u;
    else high = u;
    u = (low + high) / 2;
  }
  return curve(u, P1.y, P2.y);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Animation {
  start: number;
  duration: number;
  tick: (eased: number) => void;
  settle: () => void;
}

const running = new Set<Animation>();
let framePending = false;
let timerPending = false;

function schedule(): void {
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      pump();
    });
  }
  if (!timerPending) {
    timerPending = true;
    setTimeout(() => {
      timerPending = false;
      pump();
    }, 1);
  }
}

function pump(): void {
  const now = performance.now();
  for (const animation of Array.from(running)) {
    const elapsed = now - animation.start;
    const fraction = animation.duration <= 0 ? 1 : Math.min(1, elapsed / animation.duration);
    animation.tick(ease(fraction));
    if (fraction >= 1) {
      running.delete(animation);
      animation.settle();
    }
  }
  if (running.size > 0) schedule();
}

export function animate(
  duration: number,
  tick: (eased: number) => void,
  settle: () => void,
): void {
  tick(0);
  if (reducedMotion() || duration <= 0) {
    tick(1);
    settle();
    return;
  }
  running.add({ start: performance.now(), duration, tick, settle });
  schedule();
}

export function fixed4(value: number): string {
  return value.toFixed(4);
}

export function fixed2(value: number): string {
  return value.toFixed(2);
}
