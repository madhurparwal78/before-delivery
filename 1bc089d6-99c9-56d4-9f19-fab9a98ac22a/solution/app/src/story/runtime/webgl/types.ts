import type { PerspectiveCamera, Scene } from "three";

import type { SceneId, Stage } from "../stage";
import type { Quality } from "./quality";

interface FrameInfo {
  /** Seconds of story time, for the only two loops (water ripples, lantern flicker); frozen under reduced motion. */
  elapsed: number;
  /** Seconds since the previous drawn frame (0 under reduced motion). */
  delta: number;
  /** This scene's own scroll progress, 0 → 1 (see Stage.progress). */
  progress: number;
  /** This scene's window progress as the brief defines it (see Stage.window). */
  window: number;
  stage: Stage;
  quality: Quality;
}

/** One 3D window. Each owns its scene graph and camera; the experience draws only the current one. */
export interface WorldScene {
  readonly id: SceneId;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /**
   * Poses the scene for this frame. Returns true while it is still moving on its own (a loop, or a
   * pointer response settling), so the next frame is drawn even if the scroll position has not changed.
   */
  update(frame: FrameInfo): boolean;
  resize(width: number, height: number): void;
  dispose(): void;
}

export type SceneFactory = (quality: Quality) => WorldScene;
