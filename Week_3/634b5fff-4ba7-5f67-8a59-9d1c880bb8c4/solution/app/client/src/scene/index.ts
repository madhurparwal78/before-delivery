/**
 * The 3D scene of the product: a snowbound alley, five visions kindled by a match, and the shelf of 240 boxes.
 *
 * ```ts
 * createStory(canvas, { discrete }): StoryController
 * StillChapter({ chapter, lit }): JSX element   // the illustrated chapter used when `mode === 'still'`
 * ```
 *
 * `canvas` must be the first `<canvas>` in the document, fixed over the viewport (`position: fixed; inset: 0`)
 * and behind everything. `discrete` is true under reduced motion (no scrubbing, no snow, no burn timer).
 * If WebGL 2 is not available `createStory` does not throw: it returns a controller with `mode: 'still'`, which
 * has no three.js objects but the same story state machine; draw `StillChapter` for `controller.chapter`.
 *
 * StoryController
 *   mode                       'webgl' | 'still'
 *   setProgress(p)             continuous mode: scroll progress 0..1 (ignored by the discrete modes)
 *   stepToChapter(c)           discrete modes: go to a chapter at once and put any light out (ignored otherwise)
 *   strike(): boolean          lights the chapter's vision; only in stove..grandmother and only while nothing burns
 *   chapter, litMatches        current chapter; 0, 1 or 12
 *   onMatchOut(l)              l('match' | 'bundle') when a match goes out (never in the discrete modes)
 *   onChange(l)                the chapter or the lit state changed
 *   subscribe(l)               l(FrameInfo) once per animation frame (and on changes in still mode)
 *   setBoxes(states)           240 CellState values, index = number - 1
 *   setHold(hold | null)       { number, remainingMs, holdMs }: the server's latest answer; null when the hold ended
 *   setShelfLayout(layout)     where the DOM grid is (see below)
 *   shelfMapping()             { visible, k, tx, ty }
 *   setDim(0..1)               a black wash over the scene, for sheets
 *
 * Shelf mapping. The page draws a transparent CSS grid of 240 square cells of `cellPx` pixels over the boxes.
 * `setShelfLayout({ columns, rows, cellPx, left, top, scrollTop, width, height })` gives `left` and `top`, the
 * viewport position of the top-left corner of cell 1 when the grid is neither scrolled nor transformed, and
 * `scrollTop`, how far the grid's own container is scrolled. Apply the grid container
 * `transform-origin: 0 0; transform: translate(tx px, ty px) scale(k)` with the result of `shelfMapping()` each
 * frame: every cell then lies exactly over its projected box (the grid container's top-left being at `left, top`).
 * At the final camera pose with scrollTop 0 the result is k 1, tx 0, ty 0. `visible` is false while the camera is
 * in the alley (progress below 0.86 and no hold focus). The rig holds all 240 boxes in `columns` per row.
 *
 * window.__scene is a read-only getter returning a frozen snapshot of live objects: progress, chapter,
 * cameraPosition (the THREE camera), lightIntensity (the match PointLight over its power-of-two gain),
 * litMatches (the lit match objects), holdRemainingMs and matchLength (from setHold).
 */
import { WebglStory } from "./webglStory.js";
import { StillStory } from "./stillStory.js";
import type { StoryController, StoryOptions } from "./types.js";

export { StillChapter } from "./StillChapter.js";
export type {
  MatchKind,
  ShelfLayout,
  ShelfMapping,
  StoryController,
} from "./types.js";

const CONTEXT = { alpha: false, depth: true, stencil: false, powerPreference: "high-performance" } as const;

/**
 * A hardware context gets multisampling; when only a software renderer is available (it would be refused as a major
 * performance caveat) a second request takes it without multisampling, which the CPU could not afford.
 */
const openContext = (canvas: HTMLCanvasElement): WebGL2RenderingContext | null =>
  canvas.getContext("webgl2", { ...CONTEXT, antialias: true, failIfMajorPerformanceCaveat: true }) ??
  canvas.getContext("webgl2", { ...CONTEXT, antialias: false });

export const createStory = (canvas: HTMLCanvasElement, options: StoryOptions): StoryController => {
  try {
    const context = openContext(canvas);
    if (context) return new WebglStory(canvas, context, options.discrete);
  } catch {
    return new StillStory();
  }
  return new StillStory();
};
