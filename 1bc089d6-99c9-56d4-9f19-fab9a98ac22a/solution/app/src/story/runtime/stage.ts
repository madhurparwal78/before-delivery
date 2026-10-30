import { STORY_LENGTH_MINUTES, STORY_START_MINUTES } from "../content";

const SCENE_IDS = ["dusk", "city", "water", "flowers", "moon", "lantern"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/**
 * Scroll state shared by the DOM runtime and the WebGL scenes, recomputed once per frame.
 *
 * `progress[id]` runs 0 → 1 while the scene's window (`[data-scene=id]`) travels through the viewport:
 * 0 when its top edge reaches the bottom of the viewport, 1 when its bottom edge leaves the top.
 * `window[id]` is the window's own progress as the brief defines it: 0 while its top edge is at or below the
 * top of the screen, 1 once its bottom edge reaches the bottom of the screen (the scroll-linked copy uses it).
 * `current` is the scene covering the most of the viewport, or null when only text chapters are on screen.
 */
export interface Stage {
  progress: Record<SceneId, number>;
  window: Record<SceneId, number>;
  current: SceneId | null;
  /** Story clock minutes after 21:00: whole minutes of page fraction × 60, rounded down (0 → 60). */
  minutes: number;
  /** Pointer position, -1 → 1 on both axes (0, 0 at the centre; y is +1 at the top of the screen). */
  pointer: { x: number; y: number };
}

const zeros = () => Object.fromEntries(SCENE_IDS.map((id) => [id, 0])) as Record<SceneId, number>;

export function createStage(): Stage {
  return { progress: zeros(), window: zeros(), current: null, minutes: 0, pointer: { x: 0, y: 0 } };
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function measureStage(stage: Stage, windows: Map<SceneId, HTMLElement>) {
  const viewport = window.innerHeight;
  let best = 0;
  stage.current = null;
  windows.forEach((element, id) => {
    const rect = element.getBoundingClientRect();
    stage.progress[id] = clamp01((viewport - rect.top) / (rect.height + viewport));
    stage.window[id] = windowProgress(rect, viewport);
    const cover = Math.max(0, Math.min(rect.bottom, viewport) - Math.max(rect.top, 0)) / viewport;
    if (cover > best) {
      best = cover;
      stage.current = id;
    }
  });
  const scrollable = Math.max(1, document.documentElement.scrollHeight - viewport);
  stage.minutes = Math.min(STORY_LENGTH_MINUTES, Math.max(0, Math.floor((window.scrollY * STORY_LENGTH_MINUTES) / scrollable)));
}

/** 0 while the box's top is at or below the top of the screen, 1 once its bottom reaches the bottom of the screen. */
export function windowProgress(rect: DOMRect, viewport: number) {
  return clamp01(-rect.top / Math.max(1, rect.height - viewport));
}

/** "21:00" at the top of the page through "22:00" only at the very bottom. */
export function storyClock(minutesIn: number) {
  const minutes = STORY_START_MINUTES + minutesIn;
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
