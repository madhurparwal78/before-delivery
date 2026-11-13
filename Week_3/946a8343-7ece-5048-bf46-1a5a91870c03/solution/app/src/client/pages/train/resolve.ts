// Train Ref Resolve: the motion of a train car and the scrambling kicker. Everything here is plain DOM work driven by
// element.animate and page timers, so the verifier's paused page clock decides when the kicker moves.
const STEP_PX = 24;
const STEP_MS = 300;
const LEAVE_MS = 160;
export const STAGGER_MS = 80;
const SCRAMBLE_START_MS = 100;
const GLYPH_TICK_MS = 40;
const FIRST_LOCK_MS = 150;
const LOCK_GAP_MS = 50;
const HEX = "0123456789abcdef";

export type StepFrom = "above" | "below";

export function shortId(sha: string): string {
  return sha.slice(0, 7);
}

export function randomGlyphs(count: number): string {
  let out = "";
  for (let index = 0; index < count; index++) out += HEX[Math.floor(Math.random() * HEX.length)];
  return out;
}

/** A car joins from one step above or rises from one step below; `delay` staggers cars that move together. */
export function playStep(block: HTMLElement, from: StepFrom, delay: number): void {
  const offset = from === "above" ? -STEP_PX : STEP_PX;
  block.animate(
    [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
    { id: "train-step", duration: STEP_MS, delay, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards" },
  );
}

/** Fades a leaving block out; `onDone` runs when the animation has ended. */
export function playLeave(block: HTMLElement, onDone: () => void): void {
  const animation = block.animate([{ opacity: 1 }, { opacity: 0 }], {
    id: "train-leave",
    duration: LEAVE_MS,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  animation.addEventListener("finish", onDone, { once: true });
}

/**
 * Cycles the glyphs of a kicker through random hex digits from 100 ms after `delay`, every 40 ms, and locks them left to right
 * from 150 ms, one every 50 ms, on the final id. `glyphs` holds one text node. Returns a function that stops the timers.
 */
export function resolveKicker(glyphs: HTMLElement, from: string, final: string, delay: number): () => void {
  const text = glyphs.firstChild;
  if (!(text instanceof Text)) return () => undefined;
  const timers: number[] = [];
  let ticker: number | null = null;
  let locked = 0;
  const paint = () => {
    text.data = final.slice(0, locked) + randomGlyphs(final.length - locked);
  };
  const stop = () => {
    for (const timer of timers) window.clearTimeout(timer);
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    timers.length = 0;
  };
  text.data = from;
  timers.push(
    window.setTimeout(() => {
      paint();
      ticker = window.setInterval(paint, GLYPH_TICK_MS);
    }, delay + SCRAMBLE_START_MS),
  );
  for (let index = 0; index < final.length; index++) {
    timers.push(
      window.setTimeout(() => {
        locked = index + 1;
        if (locked < final.length) return paint();
        stop();
        text.data = final;
      }, delay + FIRST_LOCK_MS + LOCK_GAP_MS * index),
    );
  }
  return stop;
}
