import { reducedMotion, STATE_MS } from './motion.js';

const WHEEL_NOTCH_MS = STATE_MS;
const WIDE_FROM_PX = 1024;

export interface Strip {
  moveBy(step: number): void;
  moveTo(index: number): void;
  readonly index: number;
  refresh(): void;
}

export function isWide(): boolean {
  return window.innerWidth >= WIDE_FROM_PX;
}

export function createStrip(options: {
  readonly viewport: HTMLElement;
  readonly track: HTMLElement;
  readonly progress: HTMLElement | null;
  readonly onIndexChange?: (index: number) => void;
}): Strip {
  let index = 0;
  let lastNotch = 0;

  const cards = (): HTMLElement[] => [...options.track.children] as HTMLElement[];

  const paint = (): void => {
    const items = cards();
    if (items.length === 0) return;
    index = Math.max(0, Math.min(index, items.length - 1));
    const offset = items[index].offsetLeft - items[0].offsetLeft;
    options.track.style.transition = reducedMotion() ? 'none' : `transform ${STATE_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
    options.track.style.transform = isWide() ? `translateX(${-offset}px)` : 'none';
    if (options.progress !== null) {
      const value = items.length <= 1 ? 0 : Math.round((index / (items.length - 1)) * 100);
      options.progress.setAttribute('aria-valuenow', String(value));
      options.progress.style.setProperty('--strip-progress', `${value}%`);
    }
    options.onIndexChange?.(index);
  };

  const moveTo = (next: number): void => {
    const items = cards();
    const clamped = Math.max(0, Math.min(next, items.length - 1));
    if (clamped === index) return;
    index = clamped;
    paint();
  };

  options.viewport.addEventListener('keydown', (event) => {
    if (!isWide()) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(index + 1);
    }
  });

  options.viewport.addEventListener(
    'wheel',
    (event) => {
      if (!isWide() || event.deltaY === 0) return;
      const items = cards();
      const atEnd = event.deltaY > 0 ? index >= items.length - 1 : index <= 0;
      if (atEnd) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastNotch < WHEEL_NOTCH_MS) return;
      lastNotch = now;
      moveTo(index + (event.deltaY > 0 ? 1 : -1));
    },
    { passive: false },
  );

  window.addEventListener('resize', paint);
  paint();

  return {
    moveBy: (step: number) => moveTo(index + step),
    moveTo,
    get index(): number {
      return index;
    },
    refresh: paint,
  };
}
