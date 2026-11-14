import type { World } from "./types";

export const WORLD_COUNT = 8;
export const WORLD_STEP_DEG = 45;
export const MAX_YAW = (WORLD_COUNT - 1) * WORLD_STEP_DEG;

export const DESCENT_MS = 900;
export const TURN_MS = 450;
export const FLIGHT_MS = 700;
export const EMBLEM_DEG_PER_SECOND = 15;

export const DRAG_DEG_PER_PX = 0.1875;
export const DRAG_SELECT_PX = 80;
const SWIPE_PX = 60;

/** World k (1 to 8) turns the ring to (k − 1) × 45 degrees. */
export function yawOf(index: number): number {
  return (index - 1) * WORLD_STEP_DEG;
}

export function formatDegrees(value: number): string {
  return value.toFixed(1);
}

/** The active world is decided by the scroll position alone: one world per viewport height. */
export function activeWorldAt(scrollY: number, sectionTop: number, viewportHeight: number): number {
  const p = (scrollY - sectionTop) / viewportHeight;
  return Math.min(Math.max(Math.floor(p + 0.5), 0), WORLD_COUNT - 1) + 1;
}

/** The scroll position at which world k is active. */
export function scrollPositionOf(index: number, sectionTop: number, viewportHeight: number): number {
  return sectionTop + (index - 1) * viewportHeight;
}

export function worldAnnouncement(world: World): string {
  return `World ${world.index} of ${WORLD_COUNT}: ${world.name}, ${world.industry}`;
}

/** The two-digit number of a world, as the rail and overlay show it. */
export function worldNumber(index: number): string {
  return String(index).padStart(2, "0");
}

export function worldNumeral(index: number): string {
  return `${worldNumber(index)} / ${worldNumber(WORLD_COUNT)}`;
}

export function isWorld(index: number): boolean {
  return Number.isInteger(index) && index >= 1 && index <= WORLD_COUNT;
}

/** A one-finger swipe selects a world when it is long enough and more horizontal than vertical. */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy);
}
