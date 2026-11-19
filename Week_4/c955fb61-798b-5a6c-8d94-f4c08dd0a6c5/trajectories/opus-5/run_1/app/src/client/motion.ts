import { fromIso } from '../shared/dates.js';
import { prefersReducedMotion } from './dom.js';
import { state } from './state.js';
import type { Project } from '../shared/types.js';

export const DAY_WIDTH = 32;
const MAX_DEPTH = 12;

/** The cubic Bezier ease with control points (0.2, 0) and (0, 1). */
function ease(progress: number): number {
  const curveX = (t: number): number => 3 * (1 - t) * (1 - t) * t * 0.2 + t * t * t;
  const curveY = (t: number): number => 3 * (1 - t) * t * t * 1 + t * t * t;
  let low = 0;
  let high = 1;
  let t = progress;
  for (let step = 0; step < 24; step += 1) {
    const x = curveX(t);
    if (Math.abs(x - progress) < 1e-5) break;
    if (x < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return curveY(t);
}

interface Slide {
  itemId: string;
  offsetPx: number;
  depth: number;
}

interface Plan {
  startedAt: number;
  slides: Slide[];
  finishOffsetPx: number;
  finishDelayMs: number;
}

let plan: Plan | null = null;
let frame = 0;

function settle(): void {
  for (const bar of document.querySelectorAll<HTMLElement>('.bar[data-item-id]')) {
    bar.style.transform = '';
    bar.removeAttribute('data-motion');
  }
  const marker = document.getElementById('finish-marker');
  if (marker) {
    marker.style.transform = '';
    marker.removeAttribute('data-motion');
  }
}

export function cancelMotion(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  plan = null;
  settle();
}

/** The fewest links from the edited item to each other item, capped at 12. */
function depths(project: Project, editedItemId: string | null): Map<string, number> {
  const result = new Map<string, number>();
  if (editedItemId === null) {
    for (const item of project.items) result.set(item.id, 0);
    return result;
  }
  const successors = new Map<string, string[]>();
  for (const link of project.links) {
    const list = successors.get(link.from);
    if (list) list.push(link.to);
    else successors.set(link.from, [link.to]);
  }
  result.set(editedItemId, 0);
  let frontier = [editedItemId];
  let depth = 0;
  while (frontier.length > 0 && depth < MAX_DEPTH) {
    depth += 1;
    const next: string[] = [];
    for (const node of frontier) {
      for (const successor of successors.get(node) ?? []) {
        if (!result.has(successor)) {
          result.set(successor, depth);
          next.push(successor);
        }
      }
    }
    frontier = next;
  }
  return result;
}

/** Put the current frame of the knock-on on screen; true while it is still playing. */
export function paintMotion(): boolean {
  if (!plan) return false;
  const elapsed = performance.now() - plan.startedAt;
  let playing = false;

  for (const slide of plan.slides) {
    const bar = document.querySelector<HTMLElement>(`.bar[data-item-id="${slide.itemId}"]`);
    const delay = state.config.knockOnStaggerMs * slide.depth;
    const progress =
      elapsed < delay ? 0 : Math.min(1, (elapsed - delay) / Math.max(1, state.config.knockOnMs));
    if (progress < 1) playing = true;
    if (!bar) continue;
    if (progress < 1) {
      bar.style.transform = `translateX(${slide.offsetPx * (1 - ease(progress))}px)`;
      bar.setAttribute('data-motion', 'knock-on');
    } else {
      bar.style.transform = '';
      bar.removeAttribute('data-motion');
    }
  }

  const marker = document.getElementById('finish-marker');
  if (plan.finishOffsetPx !== 0) {
    const progress =
      elapsed < plan.finishDelayMs
        ? 0
        : Math.min(1, (elapsed - plan.finishDelayMs) / Math.max(1, state.config.finishMotionMs));
    if (progress < 1) playing = true;
    if (marker) {
      if (progress < 1) {
        marker.style.transform = `translateX(${plan.finishOffsetPx * (1 - ease(progress))}px)`;
        // The marker waits at the old column, then carries the attribute only while it moves.
        if (elapsed >= plan.finishDelayMs) marker.setAttribute('data-motion', 'finish');
      } else {
        marker.style.transform = '';
        marker.removeAttribute('data-motion');
      }
    }
  }

  if (!playing) plan = null;
  return playing;
}

function tick(): void {
  frame = paintMotion() ? requestAnimationFrame(tick) : 0;
}

/** Plan the knock-on for an accepted result that has just arrived. */
export function startKnockOn(
  previous: Project | null,
  next: Project,
  editedItemId: string | null,
): void {
  cancelMotion();
  if (!previous || prefersReducedMotion()) return;

  const oldStarts = new Map(previous.items.map((item) => [item.id, item.start]));
  const oldKinds = new Map(previous.items.map((item) => [item.id, item.kind]));
  const depth = depths(next, editedItemId);

  const slides: Slide[] = [];
  for (const item of next.items) {
    if (item.kind === 'group' || item.id === editedItemId) continue;
    const before = oldStarts.get(item.id);
    if (!before || !item.start || before === item.start || oldKinds.get(item.id) !== item.kind) continue;
    slides.push({
      itemId: item.id,
      offsetPx: (fromIso(before) - fromIso(item.start)) * DAY_WIDTH,
      depth: depth.get(item.id) ?? 0,
    });
  }

  const finishOffsetPx =
    previous.finish && next.finish
      ? (fromIso(previous.finish) - fromIso(next.finish)) * DAY_WIDTH
      : 0;
  const finishDelayMs = slides.reduce(
    (longest, slide) =>
      Math.max(longest, state.config.knockOnStaggerMs * slide.depth + state.config.knockOnMs),
    0,
  );

  if (slides.length === 0 && finishOffsetPx === 0) return;
  plan = { startedAt: performance.now(), slides, finishOffsetPx, finishDelayMs };
  tick();
}
