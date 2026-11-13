import type { DiffState, Scene } from '../../../shared/geometry/index.ts';
import type { Markup, Point } from '../../../shared/types.ts';
import type { DrawingStore } from '../../store/drawingStore.ts';
import type { SceneStore } from '../../store/sceneStore.ts';

/** An issue pin at its world point (`data-issue-pin`); a pin that arrives after the pane has mounted grows in with the `sheet-pin` animation. */
export interface IssuePin { id: string; x: number; y: number; title: string }

/**
 * Delta swipe: the later version shows left of the divider and the earlier one right of it (both fully with `overlay`, the divider hidden),
 * each entity carrying `data-diff` from `diff` (ids missing from it are `same`). `swipe` is the slider's percent of newer version, 0 to 100.
 */
export interface CompareLayers {
  earlier: Scene;
  later: Scene;
  diff: ReadonlyMap<string, DiffState>;
  swipe: number;
  overlay: boolean;
}

export interface CanvasPaneProps {
  /** the scene store shown: the live drawing store, or a review store */
  store: SceneStore;
  /** the live drawing store, on the Drawing screen only: adds remote crosshairs and rings, underlays, the rubber band and grips that edit */
  live?: DrawingStore;
  compare?: CompareLayers | null;
  pins?: readonly IssuePin[];
  /** the markups of the shown version, drawn in world coordinates; a flagged one carries `data-flag="geometry-changed"` */
  markups?: readonly Markup[];
  /** a tap (under 8 px, lifted within 500 ms) at a world point; while a phone measure waits for its second point the pane takes the tap itself */
  onTap?: (world: Point) => void;
  /** a touch held 500 ms (page timer) without moving 8 px: the world point and the screen point (px from the pane's top-left) */
  onLongPress?: (world: Point, screen: Point) => void;
  /** a click or Enter on an entity element of the compare view */
  onEntityActivate?: (id: string) => void;
  /** the divider was dragged: the new percent of newer version */
  onSwipeChange?: (percent: number) => void;
}
