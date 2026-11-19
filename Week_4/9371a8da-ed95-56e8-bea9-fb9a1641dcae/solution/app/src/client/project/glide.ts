// Cards gliding to new places and folding to their stubs: frame-driven movements that start quickly and settle gently.

const GLIDE_MS = 280;

/** cubic-bezier(.2,.7,.2,1), the easing of every travelling movement. */
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.2, 0.7, 0.2, 1];
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (at(x1, x2, mid) < t) low = mid;
    else high = mid;
  }
  return at(y1, y2, (low + high) / 2);
}

interface Running {
  /** The offset from the resting top the card shows right now. */
  offset: number;
  from: number;
  delay: number;
  start: number | null;
  frame: number;
}

const running = new WeakMap<HTMLElement, Running>();

/** The offset a card currently shows from its resting top (0 when it is not gliding). */
export function glideOffset(card: HTMLElement): number {
  return running.get(card)?.offset ?? 0;
}

/** Glide a card from `from` pixels away from its resting top to rest, after `delay` milliseconds. */
export function glide(card: HTMLElement, from: number, delay: number): void {
  const previous = running.get(card);
  if (previous) cancelAnimationFrame(previous.frame);
  const state: Running = { offset: from, from, delay, start: null, frame: 0 };
  running.set(card, state);
  card.style.transform = `translateY(${from}px)`;
  const step = (now: number) => {
    state.start ??= now;
    const t = Math.min(1, Math.max(0, (now - state.start - state.delay) / GLIDE_MS));
    state.offset = state.from * (1 - ease(t));
    if (t >= 1 || !card.isConnected) {
      running.delete(card);
      card.style.transform = "";
      return;
    }
    card.style.transform = `translateY(${state.offset}px)`;
    state.frame = requestAnimationFrame(step);
  };
  state.frame = requestAnimationFrame(step);
}

/** Stop a glide at once, leaving the card at rest. */
export function stopGlide(card: HTMLElement): void {
  const state = running.get(card);
  if (!state) return;
  cancelAnimationFrame(state.frame);
  running.delete(card);
  card.style.transform = "";
}

const folding = new WeakMap<HTMLElement, number>();

/** Fold a card from `from` pixels tall down to its stub's natural height, after `delay` milliseconds. */
export function foldCard(card: HTMLElement, from: number, delay: number): void {
  const previous = folding.get(card);
  if (previous !== undefined) cancelAnimationFrame(previous);
  card.style.height = "";
  const to = card.offsetHeight;
  let start: number | null = null;
  card.style.height = `${from}px`;
  card.style.overflow = "hidden";
  const step = (now: number) => {
    start ??= now;
    const t = Math.min(1, Math.max(0, (now - start - delay) / GLIDE_MS));
    if (t >= 1 || !card.isConnected) {
      folding.delete(card);
      card.style.height = "";
      card.style.overflow = "";
      return;
    }
    card.style.height = `${from + (to - from) * ease(t)}px`;
    folding.set(card, requestAnimationFrame(step));
  };
  folding.set(card, requestAnimationFrame(step));
}
