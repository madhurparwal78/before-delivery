const PANEL_MILLIS = 200;
const FIGURE_MILLIS = 360;
export const RANK_MILLIS = 280;
export const SELECTION_MILLIS = 660;
export const DRAG_HALF_LIFE_MILLIS = 240;
export const CLUSTER_MILLIS = 280;
export const CLUSTER_STAGGER_MILLIS = 40;
export const CLUSTER_MAX_STAGGER_STEPS = 12;
export const ARRIVAL_DROP_MILLIS = 420;
export const ARRIVAL_PULSE_MILLIS = 600;
export const PANEL_AFTER_GLIDE_MILLIS = 170;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const pendingTimers = new WeakMap<HTMLElement, number>();

function clearPending(node: HTMLElement): void {
  const timer = pendingTimers.get(node);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingTimers.delete(node);
  }
}

/** Entry: `opening` then `open`. Under reduced motion it shows `open` at once. */
export function openWithMotion(node: HTMLElement): void {
  clearPending(node);
  if (reducedMotion()) {
    node.dataset['state'] = 'open';
    return;
  }
  node.dataset['state'] = 'opening';
  pendingTimers.set(
    node,
    window.setTimeout(() => {
      pendingTimers.delete(node);
      node.dataset['state'] = 'open';
    }, PANEL_MILLIS),
  );
}

/** A sheet, panel or dialog restored by a reload reports `open` from its first frame. */
export function openAtOnce(node: HTMLElement): void {
  clearPending(node);
  node.dataset['state'] = 'open';
}

export function closeWithMotion(node: HTMLElement, afterClosed?: () => void): void {
  clearPending(node);
  if (reducedMotion()) {
    node.dataset['state'] = 'closed';
    afterClosed?.();
    return;
  }
  node.dataset['state'] = 'closing';
  pendingTimers.set(
    node,
    window.setTimeout(() => {
      pendingTimers.delete(node);
      node.dataset['state'] = 'closed';
      afterClosed?.();
    }, PANEL_MILLIS),
  );
}

export type FigureKind =
  | 'legend-count'
  | 'critical-lines'
  | 'cart-total'
  | 'checkout-total'
  | 'order-total'
  | 'on-hand'
  | 'held'
  | 'available'
  | 'distance'
  | 'shop-available'
  | 'review-count'
  | 'review-badge'
  | 'slot-count';

const figureFrames = new WeakMap<HTMLElement, number>();

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Counts a figure from its old value to its new one. `data-value` holds the final value
 * from the first frame and `data-counting` is true until the final value shows.
 */
export function setFigure(
  node: HTMLElement,
  kind: FigureKind,
  value: number,
  format: (shown: number) => string,
): void {
  const previousFrame = figureFrames.get(node);
  if (previousFrame !== undefined) cancelAnimationFrame(previousFrame);

  const hadValue = node.dataset['value'] !== undefined;
  const from = hadValue ? Number(node.dataset['value']) : value;
  node.dataset['figure'] = kind;
  node.dataset['value'] = kind === 'distance' ? value.toFixed(2) : String(value);

  if (!hadValue || from === value || reducedMotion()) {
    node.dataset['counting'] = 'false';
    node.textContent = format(value);
    return;
  }

  node.dataset['counting'] = 'true';
  const startedAt = performance.now();
  const step = (nowMillis: number): void => {
    const progress = Math.min(1, (nowMillis - startedAt) / FIGURE_MILLIS);
    const shown = from + (value - from) * easeOutCubic(progress);
    node.textContent = format(progress === 1 ? value : shown);
    if (progress < 1) {
      figureFrames.set(node, requestAnimationFrame(step));
    } else {
      figureFrames.delete(node);
      node.dataset['counting'] = 'false';
    }
  };
  figureFrames.set(node, requestAnimationFrame(step));
}

export function quinticEaseOut(progress: number): number {
  return 1 - (1 - progress) ** 5;
}
