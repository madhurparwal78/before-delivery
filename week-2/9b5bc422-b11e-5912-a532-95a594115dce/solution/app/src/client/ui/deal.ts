import type { Camera } from "../store/preferences.ts";

export type ViewState = "page" | "dealing" | "canvas" | "gathering";

const LIFT_GAP_MS = 30;
const LAST_LIFT_MS = 600;
const TRAVEL_MS = 320;
const FADE_MS = 180;
const CROSSFADE_MS = 120;
const CARD_WIDTH = 240;

export type Rects = Map<string, DOMRect>;

const cardElement = (id: string): HTMLElement | null => document.querySelector(`.slot[data-block-id="${CSS.escape(id)}"]`);
const pageElement = (id: string): HTMLElement | null => document.querySelector(`[data-page-block="${CSS.escape(id)}"]`);

function measure(ids: readonly string[], element: (id: string) => HTMLElement | null): Rects {
  const rects: Rects = new Map();
  for (const id of ids) {
    const rect = element(id)?.getBoundingClientRect();
    if (rect) rects.set(id, rect);
  }
  return rects;
}

export const measureCards = (ids: readonly string[]): Rects => measure(ids, cardElement);
export const measurePage = (ids: readonly string[]): Rects => measure(ids, pageElement);

type Part = { delay: number; duration: number; apply: (progress: number) => void };

const easeOut = (progress: number): number => 1 - (1 - progress) ** 4;

/** Runs parts on animation frames; answers a function that stops them where they are. */
function play(parts: readonly Part[], done: () => void): () => void {
  const start = performance.now();
  let frame = 0;
  const step = (): void => {
    const elapsed = performance.now() - start;
    let running = false;
    for (const { delay, duration, apply } of parts) {
      const progress = Math.min(Math.max((elapsed - delay) / duration, 0), 1);
      apply(progress);
      if (progress < 1) running = true;
    }
    if (running) frame = requestAnimationFrame(step);
    else done();
  };
  step();
  return () => cancelAnimationFrame(frame);
}

const liftGap = (count: number): number => Math.min(LIFT_GAP_MS, LAST_LIFT_MS / Math.max(count - 1, 1));

type Box = { left: number; top: number; width: number; opacity: number };

const asBox = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, opacity: 1 });

/** The screen box a card rests at when nothing moves it. */
function restingBox(element: HTMLElement, canvas: HTMLElement, camera: Camera): Box {
  const region = canvas.getBoundingClientRect();
  return {
    left: region.left + element.offsetLeft * camera.zoom + camera.panX,
    top: region.top + element.offsetTop * camera.zoom + camera.panY,
    width: CARD_WIDTH * camera.zoom,
    opacity: 1,
  };
}

/** Moves one card between two screen boxes, in world units so the zoom needs no second path. */
function flight(element: HTMLElement, resting: Box, camera: Camera, from: Box, to: Box, delay: number): Part {
  const between = (a: number, b: number, share: number): number => a + (b - a) * share;
  return {
    delay,
    duration: TRAVEL_MS,
    apply: (progress) => {
      const share = easeOut(progress);
      element.style.transform = `translate(${(between(from.left, to.left, share) - resting.left) / camera.zoom}px, ${(between(from.top, to.top, share) - resting.top) / camera.zoom}px)`;
      element.style.width = `${between(from.width, to.width, share) / camera.zoom}px`;
      element.style.opacity = String(between(from.opacity, to.opacity, share));
    },
  };
}

const fade = (element: HTMLElement, from: number, to: number, duration: number): Part => ({
  delay: 0,
  duration,
  apply: (progress) => { element.style.opacity = String(from + (to - from) * progress); },
});

const fadeOutBox = (box: Box): Box => ({ ...box, opacity: 0 });

type Travel = {
  canvas: HTMLElement;
  sheet: HTMLElement;
  camera: Camera;
  order: readonly string[];
  /** Where each card is now: page blocks on a Deal, cards on a Gather or a reversal. */
  current: Rects;
  /** Where each block lands on the page; empty when going to the canvas. */
  pageTargets: Rects;
  going: "page" | "canvas";
  reversing: boolean;
};

function cardParts({ canvas, camera, order, current, pageTargets, going, reversing }: Travel): Part[] {
  const gap = reversing ? 0 : liftGap(order.length);
  return order.flatMap((id, index) => {
    const element = cardElement(id);
    if (!element) return [];
    const resting = restingBox(element, canvas, camera);
    const held = current.get(id);
    const from = held ? asBox(held) : going === "canvas" ? fadeOutBox(resting) : resting;
    const target = pageTargets.get(id);
    const to = going === "page" ? (target ? asBox(target) : fadeOutBox(resting)) : resting;
    return [flight(element, resting, camera, from, to, index * gap)];
  });
}

/** The Deal, the Gather, or a reversal of either, with the sheet fading to match. */
export function travel(plan: Travel, done: () => void): () => void {
  return play([...cardParts(plan), fade(plan.sheet, plan.going === "canvas" ? 1 : 0, plan.going === "canvas" ? 0 : 1, FADE_MS)], done);
}

export function crossfade(leaving: HTMLElement, arriving: HTMLElement, done: () => void): () => void {
  return play([fade(leaving, 1, 0, CROSSFADE_MS), fade(arriving, 0, 1, CROSSFADE_MS)], done);
}

export function drawConnectors(root: HTMLElement, done: () => void): () => void {
  const lines = [...root.querySelectorAll<SVGElement>("[data-connector-id]")];
  return play(lines.length ? lines.map((line) => ({
    delay: 0,
    duration: FADE_MS,
    apply: (progress) => { line.style.strokeDashoffset = String(1 - easeOut(progress)); },
  })) : [{ delay: 0, duration: 0, apply: () => undefined }], done);
}

/** Hands cards and panes back to the stylesheet once they have arrived. */
export function clearMotion(ids: readonly string[], panes: readonly (HTMLElement | null)[]): void {
  for (const id of ids) {
    const element = cardElement(id);
    if (element) {
      element.style.transform = "";
      element.style.width = "";
      element.style.opacity = "";
    }
  }
  for (const pane of panes) if (pane) pane.style.opacity = "";
}
