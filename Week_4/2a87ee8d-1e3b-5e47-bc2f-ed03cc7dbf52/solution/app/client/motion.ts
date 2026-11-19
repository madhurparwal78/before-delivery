// Every motion in the product, with its timing from the brief. Each one is a Web Animation on transform or
// opacity only, so the page's animation controls can pause and step it; reduced motion swaps in the substitute.

export const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
export const EASE_SOFT = "cubic-bezier(.2,.8,.2,1)";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Card entrance: notes rise and fade in, 18 ms apart, the last starting no later than 560 ms after the first. */
export function entrance(notes: HTMLElement[]): void {
  if (reducedMotion() || notes.length === 0) return;
  const gap = notes.length > 1 ? Math.min(18, 560 / (notes.length - 1)) : 0;
  notes.forEach((el, i) =>
    el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
      duration: 240,
      delay: i * gap,
      easing: EASE_SOFT,
      fill: "backwards",
    }),
  );
}

/** Note lands: a new note or card back fades in from slightly smaller. */
export function lands(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
}

/** Lift: the picked-up note grows slightly and its shadow deepens (the accent outline is a class). */
export function lift(el: HTMLElement): Animation | null {
  if (reducedMotion()) return null;
  return el.animate([{ transform: "none" }, { transform: "scale(1.04)" }], { duration: 120, easing: "ease-out", fill: "forwards" });
}

/**
 * Spring drop from an offset (local px) and a release velocity (local px/s) to rest, with stiffness 400 and
 * damping 32 for a unit mass, ending within half a pixel of rest. Computed in advance and played as one animation.
 */
export function springDrop(el: HTMLElement, dx: number, dy: number, vx: number, vy: number, fromScale: number): void {
  if (reducedMotion()) return;
  const k = 400;
  const c = 32;
  const step = 1 / 120;
  let x = dx;
  let y = dy;
  let ux = vx;
  let uy = vy;
  const frames: Keyframe[] = [];
  let t = 0;
  while (t < 0.6) {
    const settle = Math.max(0, 1 - t / 0.2);
    frames.push({ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 + (fromScale - 1) * settle).toFixed(4)})` });
    if (Math.hypot(x, y) < 0.5 && Math.hypot(ux, uy) < 20 && t > 0) break;
    ux += (-k * x - c * ux) * step;
    uy += (-k * y - c * uy) * step;
    x += ux * step;
    y += uy * step;
    t += step;
  }
  frames.push({ transform: "none" });
  el.animate(frames, { duration: Math.min(600, Math.round(t * 1000) + 8), easing: "linear" });
}

/** Snap-back: a failed move glides back to its saved spot; the accent outline flash is a separate ring. */
export function snapBack(el: HTMLElement, dx: number, dy: number, ring: HTMLElement | null): void {
  if (reducedMotion()) return;
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: "ease-out" });
  ring?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1000, easing: "ease-out", fill: "forwards" });
}

/** The face-down flip of one card: a turn on the vertical axis with the back face swapped out when edge-on. */
export function flip(card: HTMLElement, back: HTMLElement, delay: number): Animation {
  const timing: KeyframeAnimationOptions = { duration: 420, delay, easing: "cubic-bezier(.3,.9,.4,1)", fill: "backwards" };
  back.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.5 },
      { opacity: 0, offset: 0.5 },
      { opacity: 0, offset: 1 },
    ],
    { ...timing, fill: "both" },
  );
  return card.animate(
    [{ transform: "perspective(600px) rotateY(0deg)" }, { transform: "perspective(600px) rotateY(90deg)", offset: 0.5 }, { transform: "perspective(600px) rotateY(0deg)" }],
    timing,
  );
}

/** The reduced-motion reveal: the back face crossfades away. */
export function crossfade(back: HTMLElement): Animation {
  return back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" });
}

/** Wave delays for distance ranks: 24 ms apart, shortened evenly past 21 ranks so the last starts by 480 ms. */
export function rankGap(ranks: number): number {
  return ranks > 21 ? 480 / (ranks - 1) : 24;
}

/** Cursor glide to a new board position. */
export function glide(el: HTMLElement, from: string, to: string): void {
  if (reducedMotion()) return;
  el.animate([{ transform: from }, { transform: to }], { duration: 100, easing: "linear" });
}

export function slideIn(el: HTMLElement, from: string): void {
  if (reducedMotion()) return;
  el.animate([{ transform: from }, { transform: "none" }], { duration: 250, easing: "cubic-bezier(.2,.9,.3,1.05)" });
}

export function rise(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
}
