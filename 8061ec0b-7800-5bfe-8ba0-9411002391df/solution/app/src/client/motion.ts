// The one motion vocabulary: three speeds, one easing, the handle's spring, all run on the Motion library's frame
// loop. Under reduced motion every tween lands on its final value at once and nothing is left running.

import { animate, type AnimationPlaybackControls } from "motion";
import { prefersReducedMotion } from "./hooks.js";

/** Quick 150-250 ms, medium 350-500 ms, long 600-800 ms (brief: Motion and effects). */
export const QUICK = 180;
export const MEDIUM = 420;
export const LONG = 700;

/** Starts quickly and slows gently into place. */
const EASE: [number, number, number, number] = [0, 0, 0.58, 1];

/** How far the rail handle's spring carries past its notch before it comes back. */
const SPRING_OVERSHOOT_PX = 5;
/** The share of the spring spent travelling out to the overshoot. */
const SPRING_OUT = 0.55;

export type Motion = AnimationPlaybackControls | null;

interface TweenOptions { delay?: number; onComplete?: () => void }

/**
 * Tween a number from `from` to `to` over `ms`, calling `onUpdate` with the start value at once and then on every
 * frame; instant under reduced motion.
 */
export function tween(from: number, to: number, ms: number, onUpdate: (value: number) => void,
  { delay = 0, onComplete }: TweenOptions = {}): Motion {
  if (prefersReducedMotion() || from === to) {
    onUpdate(to);
    onComplete?.();
    return null;
  }
  onUpdate(from);
  return animate(from, to, { duration: ms / 1000, delay: delay / 1000, ease: EASE, onUpdate, onComplete });
}

/**
 * The rail handle's spring: from where it is to a few pixels past the notch in the direction of travel, then back
 * onto the notch, at rest within the long speed. `pxPerUnit` converts the overshoot into the tweened unit.
 */
export function spring(from: number, to: number, pxPerUnit: number, onUpdate: (value: number) => void): Motion {
  if (prefersReducedMotion() || from === to || pxPerUnit <= 0) {
    onUpdate(to);
    return null;
  }
  const past = to + Math.sign(to - from) * (SPRING_OVERSHOOT_PX / pxPerUnit);
  return animate(from, [from, past, to], {
    duration: LONG / 1000, times: [0, SPRING_OUT, 1], ease: [EASE, "easeInOut"], onUpdate,
  });
}

/** The box of the register entry a contract sheet was opened from, kept until that sheet first draws. */
const headerOrigins = new Map<string, DOMRect>();

export function rememberHeaderOrigin(contractId: string, box: DOMRect): void {
  headerOrigins.set(contractId, box);
}

/** Grow the contract header from the register entry it was opened from, if it was; a direct load stays at rest. */
export function growHeader(contractId: string, header: HTMLElement): Motion {
  const from = headerOrigins.get(contractId);
  headerOrigins.clear();
  if (!from) return null;
  const to = header.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  header.style.transformOrigin = "0 0";
  return tween(0, 1, MEDIUM, (p) => {
    header.style.transform = p === 1 ? ""
      : `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px) scale(${sx + (1 - sx) * p}, ${sy + (1 - sy) * p})`;
  });
}

type Feedback = "--hover" | "--press";

const FEEDBACK_TARGETS = ".button, .nav__link, .choice, .register-row";
const feedback = new WeakMap<HTMLElement, Partial<Record<Feedback, Motion>>>();

function feedbackTo(node: HTMLElement, property: Feedback, value: number): void {
  const running = feedback.get(node) ?? {};
  running[property]?.stop();
  const from = Number(node.style.getPropertyValue(property) || "0");
  running[property] = tween(from, value, QUICK, (v) => node.style.setProperty(property, String(v)));
  feedback.set(node, running);
}

function feedbackTarget(event: Event): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>(FEEDBACK_TARGETS) : null;
}

const disabled = (node: HTMLElement): boolean => node.matches(":disabled, [aria-disabled='true']");

/** Buttons and rows darken slightly on hover and press inward when pressed, at the quick speed. */
export function installPointerFeedback(): void {
  document.addEventListener("pointerover", (event) => {
    const node = feedbackTarget(event);
    if (!node || disabled(node) || (event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) return;
    feedbackTo(node, "--hover", 1);
  });
  document.addEventListener("pointerout", (event) => {
    const node = feedbackTarget(event);
    if (!node || (event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) return;
    feedbackTo(node, "--hover", 0);
    feedbackTo(node, "--press", 0);
  });
  document.addEventListener("pointerdown", (event) => {
    const node = feedbackTarget(event);
    if (node && !disabled(node)) feedbackTo(node, "--press", 1);
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    document.addEventListener(type, (event) => {
      const node = feedbackTarget(event);
      if (node) feedbackTo(node, "--press", 0);
    });
  }
}
