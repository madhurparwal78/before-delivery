// The lane drop: after a hold request, an orange claim bar steps down the lanes, rests briefly on each busy
// one and settles into the assigned lane, or drops past the last lane and fades on a refusal. It is driven by
// the clock (setTimeout steps with CSS transitions between them), never by scrolling.

import { claimBar } from "./lanes.js";

const STEP_MS = 140;
const MOVE_MS = 100;
const SETTLE_MS = 260;
const FADE_MS = 240;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function offsetWithin(el: Element, container: Element): { top: number; left: number; width: number; height: number } {
  const a = el.getBoundingClientRect();
  const b = container.getBoundingClientRect();
  return { top: a.top - b.top, left: a.left - b.left, width: a.width, height: a.height };
}

function strips(stack: HTMLElement): HTMLElement[] {
  return [...stack.querySelectorAll<HTMLElement>(".lane__strip")];
}

/** Puts the bar just above lane 1, over the chosen dates, while the request is pending. */
export function showPendingBar(stack: HTMLElement, fraction: { left: number; width: number }): HTMLDivElement {
  const bar = claimBar();
  bar.classList.add("claim-bar--travel");
  const first = strips(stack)[0];
  const groups = stack.querySelector(".lanes__groups");
  if (first && groups) {
    const box = offsetWithin(first, stack);
    const gutter = offsetWithin(groups, stack).top;
    bar.style.left = `${box.left + box.width * fraction.left}px`;
    bar.style.width = `${box.width * fraction.width}px`;
    bar.style.transform = `translateY(${Math.max(0, gutter - 12)}px)`;
  }
  stack.append(bar);
  return bar;
}

function moveTo(bar: HTMLElement, y: number, ms: number): void {
  bar.style.transitionDuration = `${ms}ms`;
  bar.style.transform = `translateY(${y}px)`;
}

function laneY(stack: HTMLElement, strip: HTMLElement, bar: HTMLElement): number {
  const box = offsetWithin(strip, stack);
  return box.top + (box.height - bar.offsetHeight) / 2;
}

/** Steps over every lane above the assigned one, then settles into it. */
export async function dropInto(stack: HTMLElement, bar: HTMLElement, laneIndex: number): Promise<void> {
  const all = strips(stack);
  for (const strip of all.slice(0, laneIndex)) {
    strip.closest(".lane")?.classList.add("lane--passing");
    moveTo(bar, laneY(stack, strip, bar), MOVE_MS);
    await wait(STEP_MS);
    strip.closest(".lane")?.classList.remove("lane--passing");
  }
  const target = all[laneIndex];
  if (target) moveTo(bar, laneY(stack, target, bar), SETTLE_MS);
  await wait(SETTLE_MS);
  bar.remove();
}

/** Steps past every lane, drops below the last and fades out. */
export async function dropThrough(stack: HTMLElement, bar: HTMLElement): Promise<void> {
  const all = strips(stack);
  for (const strip of all) {
    moveTo(bar, laneY(stack, strip, bar), MOVE_MS);
    await wait(STEP_MS);
  }
  const last = all.at(-1);
  if (last) {
    const box = offsetWithin(last.closest(".lane") ?? last, stack);
    moveTo(bar, box.top + box.height + 4, MOVE_MS);
  }
  await wait(STEP_MS);
  bar.style.transitionDuration = `${FADE_MS}ms`;
  bar.classList.add("claim-bar--gone");
  await wait(FADE_MS);
  bar.remove();
}

/** Counts a numeral down one whole number at a time over about 420 ms. */
export async function countDown(numeral: HTMLElement, from: number, to: number): Promise<void> {
  const steps = from - to;
  for (let value = from - 1; value >= to && steps > 0; value -= 1) {
    await wait(Math.round(420 / steps));
    numeral.textContent = String(value);
  }
  numeral.textContent = String(to);
}
