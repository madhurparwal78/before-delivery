// The part of a drawing page that both the live Drawing and the read-only Review share: the scene, the camera, the selection,
// the pointer (snaps, window selection, panning, wheel), Find and the drafting aids. No DOM: the pane passes pane px.
import {
  PAPER_SIZES, distReport, distance, domEntities, findEntities, panToReveal, pickEntity, resolvePointer, screenToWorld,
  selectInWindow, updateScene, wheelZoom, windowMode, zoomAllView,
} from '../../shared/geometry/index.ts';
import type { DraftingAids, ResolvedPointer, Scene, SceneInput, Size, SnapCandidate, View } from '../../shared/geometry/index.ts';
import { PROMPTS } from '../../shared/commands/stages.ts';
import * as copy from '../../shared/copy.ts';
import type { Point, Rect, Sheet } from '../../shared/types.ts';
import type { FocusTarget, GripView, LoadStatus, SceneSnapshot } from './types.ts';

/** Brief: Large drawings and Find: a revealed entity sits at least 48 px inside each pane edge. */
const FIND_MARGIN_PX = 48;
/** A press that moves less than this is a click, not the start of a window. */
const CLICK_SLOP_PX = 3;
/** Brief: Pages (Drawing): an empty drawing starts at zoom 10 with world 0,0 near the pane's bottom-left. */
const DEFAULT_ZOOM = 10;
const DEFAULT_ORIGIN_INSET_PX = 40;
/** The corner chips take a band along the top (two rows where the right group wraps) and the bottom of the pane; the first view keeps the drawing out of them (ZOOMALL still fits the whole pane). */
export const CHIP_BAND_TOP_PX = 120;
export const CHIP_BAND_BOTTOM_PX = 64;

export interface SceneEnv {
  /** PLOT_DOM_MARGIN_PX and PLOT_DOM_CEILING */
  domMarginPx: number;
  domCeiling: number;
  announce(text: string): void;
}

/** One pointer drag in progress: pan, window selection, grip drag... */
export interface DragHandler {
  move(at: Point): void;
  end(at: Point, shift: boolean): void;
}

/** The words the drafting aid buttons and the announcements use, one per aid the pointer resolver knows. */
export const AID_LABEL = { snap: 'Snap', ortho: 'Ortho', grid: 'Grid', polar: 'Polar' } as const satisfies Record<keyof DraftingAids, string>;
export type DraftingAid = keyof typeof AID_LABEL;

const sameSnap = (a: SnapCandidate | null, b: SnapCandidate | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id && a.point[0] === b.point[0] && a.point[1] === b.point[1]);

/** The paper of a sheet layout as a bounds rectangle in the layout's Y-up space (the sheet is drawn flipped, see CanvasPane). */
function paperBounds(sheet: Sheet): Rect {
  const { width, height } = PAPER_SIZES[sheet.size];
  return [0, -height, width, 0];
}

/** The snapshot of a store before anything is shown: an empty camera, Snap on and the other aids off, the Ready prompt. */
export function initialSceneSnapshot(scene: Scene, status: LoadStatus): SceneSnapshot {
  return {
    status, scene, dom: [], revision: 0, view: { zoom: 1, panX: 0, panY: 0 }, pane: { width: 0, height: 0 }, zoomAll: null, sheet: null,
    selection: new Set(), grips: [], hover: { snap: null }, window: null,
    aids: { snap: true, ortho: false, grid: false, polar: false }, prompt: copy.PROMPT_READY, measuring: false,
    find: { open: false, query: '', matches: [], index: -1 }, focus: null,
  };
}

export class SceneStore<S extends SceneSnapshot = SceneSnapshot> {
  protected snapshot: S;
  protected readonly env: SceneEnv;
  private readonly listeners = new Set<() => void>();
  private readonly layoutViews = new Map<string | null, View>();
  private drag: DragHandler | null = null;
  private spaceHeld = false;
  private viewReady = false;
  private focusSeq = 0;
  private measureFrom: Point | null = null;
  private batching = 0;
  private dirty = false;
  /** The first view of the model: a stored one (the grading view route), else fit the entities silently, else zoom 10 near the bottom-left. */
  protected initialView: View | null = null;
  private domKey: { version: number; view: View; pane: object; selection: ReadonlySet<string> } | null = null;

  constructor(initial: S, env: SceneEnv) {
    this.snapshot = initial;
    this.env = env;
  }

  // ------------------------------------------------------------ subscription

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): S => this.snapshot;

  /** Publishes a new snapshot with `patch` merged in; slices not in `patch` keep their identity. */
  protected update(patch: Partial<SceneSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.refreshDom();
    if (this.batching > 0) this.dirty = true;
    else this.notify();
  }

  /** Several updates, one notification. */
  protected batch(run: () => void): void {
    this.batching += 1;
    try {
      run();
    } finally {
      this.batching -= 1;
      if (this.batching === 0 && this.dirty) {
        this.dirty = false;
        this.notify();
      }
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private refreshDom(): void {
    const { scene, view, pane, selection } = this.snapshot;
    const key = this.domKey;
    if (key && key.version === scene.version && key.view === view && key.pane === pane && key.selection === selection) return;
    this.domKey = { version: scene.version, view, pane, selection };
    this.snapshot = { ...this.snapshot, dom: domEntities(scene, view, pane, this.env.domMarginPx, this.env.domCeiling, selection) };
  }

  // ------------------------------------------------------------ scene

  /** Brings the scene up to date with `input` (incremental by object identity) and drops what can no longer be selected. */
  protected setSceneInput(input: SceneInput): void {
    this.update({ scene: updateScene(this.snapshot.scene, input) });
    this.pruneSelection();
  }

  private pruneSelection(): void {
    const { scene, selection } = this.snapshot;
    const kept = [...selection].filter((id) => scene.byId.get(id)?.selectable === true);
    if (kept.length !== selection.size) this.setSelection(kept);
  }

  // ------------------------------------------------------------ camera

  setPaneSize(width: number, height: number): void {
    const { pane } = this.snapshot;
    if (pane.width === width && pane.height === height) return;
    this.update({ pane: { width, height } });
    this.initialiseView();
  }

  protected initialiseView(): void {
    const { pane, scene } = this.snapshot;
    if (this.viewReady || pane.width === 0 || !this.isLoaded()) return;
    this.viewReady = true;
    const fallback: View = { zoom: DEFAULT_ZOOM, panX: DEFAULT_ORIGIN_INSET_PX, panY: pane.height - DEFAULT_ORIGIN_INSET_PX };
    const free: Size = { width: pane.width, height: pane.height - CHIP_BAND_TOP_PX - CHIP_BAND_BOTTOM_PX };
    const fitted = zoomAllView(scene.bounds, free, fallback);
    const first = this.initialView ?? (scene.bounds ? { ...fitted, panY: fitted.panY + CHIP_BAND_TOP_PX } : fallback);
    this.layoutViews.set(null, first);
    if (this.snapshot.sheet === null) this.applyView(first);
  }

  /** Whether the document the scene shows has arrived (a review scene is loaded from the start). */
  protected isLoaded(): boolean {
    return true;
  }

  /** Sets the camera of the layout shown without telling anyone (a follow copies the view of someone else). */
  protected applyView(view: View): void {
    this.layoutViews.set(this.snapshot.sheet?.id ?? null, view);
    this.update({ view });
  }

  /** The person pans or zooms: a follow stops and the new view is used at once. */
  moveView(view: View): void {
    this.stopFollowing();
    this.applyView(view);
    this.viewChanged();
  }

  panBy(dx: number, dy: number): void {
    const { view } = this.snapshot;
    this.moveView({ ...view, panX: view.panX + dx, panY: view.panY + dy });
  }

  /** ZOOMALL: fit every visible entity (or the paper of the sheet shown) with 24 px each side; the pane animates the move. */
  zoomAll(): void {
    const { view, pane, sheet } = this.snapshot;
    const bounds = sheet ? paperBounds(sheet) : this.snapshot.scene.bounds;
    this.stopFollowing();
    const target = zoomAllView(bounds, pane, view);
    this.layoutViews.set(sheet?.id ?? null, target);
    this.update({ view: target, zoomAll: { token: (this.snapshot.zoomAll?.token ?? 0) + 1, from: view } });
    this.viewChanged();
  }

  /** Pans by the least amount that puts the entity's box 48 px inside each pane edge (Find and Entities Enter). */
  panToEntity(id: string): void {
    const entity = this.snapshot.scene.byId.get(id);
    if (!entity) return;
    const { view, pane } = this.snapshot;
    this.moveView(panToReveal(entity.bounds, view, pane, FIND_MARGIN_PX));
  }

  /** Shows a sheet layout (its own camera, fitted the first time) or, with null, the model. */
  showSheet(sheet: Sheet | null): void {
    const key = sheet?.id ?? null;
    let view = this.layoutViews.get(key);
    if (!view) {
      const { pane, view: current } = this.snapshot;
      view = sheet ? zoomAllView(paperBounds(sheet), pane, current) : current;
      this.layoutViews.set(key, view);
    }
    this.update({ sheet, view, grips: [], window: null });
    this.viewChanged();
  }

  /** A hook for the live drawing: the camera moved, so followers must hear about it. */
  protected viewChanged(): void {}

  /** A hook for the live drawing: a person's own camera move ends a follow. */
  protected stopFollowing(): void {}

  // ------------------------------------------------------------ selection

  selectOnly(id: string): void {
    this.setSelection(this.isSelectable(id) ? [id] : []);
  }

  toggleSelected(id: string): void {
    if (!this.isSelectable(id)) return;
    const next = new Set(this.snapshot.selection);
    if (!next.delete(id)) next.add(id);
    this.setSelection(next);
  }

  clearSelection(): void {
    if (this.snapshot.selection.size > 0) this.setSelection([]);
  }

  protected setSelection(ids: Iterable<string>): void {
    this.update({ selection: new Set(ids) });
    this.selectionChanged();
  }

  /** A hook for the live drawing: the selection changed, so grips must follow and others see the rings. */
  protected selectionChanged(): void {}

  private isSelectable(id: string): boolean {
    return this.snapshot.scene.byId.get(id)?.selectable === true;
  }

  // ------------------------------------------------------------ pointer

  /** The last point entered, which Ortho, Polar, perpendicular and tangent measure from. */
  protected lastPoint(): Point {
    return [0, 0];
  }

  protected resolve(at: Point): ResolvedPointer {
    return this.resolveFrom(at, this.lastPoint());
  }

  /** The pointer point at `at` with Ortho and Polar measured from `last`. */
  protected resolveFrom(at: Point, last: Point): ResolvedPointer {
    const { scene, view, aids } = this.snapshot;
    return resolvePointer(scene, screenToWorld(view, at), view, aids, last);
  }

  /** Whether a drag on empty space may draw a selection window (not while a command waits for a point). */
  protected allowsWindow(): boolean {
    return true;
  }

  /** A click on the drawing: toggles the entity under the pointer into or out of the selection (Shift removes). */
  protected click(at: Point, shift: boolean): void {
    const { scene, view } = this.snapshot;
    const hit = pickEntity(scene, screenToWorld(view, at), view);
    if (!hit) return;
    const next = new Set(this.snapshot.selection);
    if (shift) next.delete(hit.id);
    else if (!next.delete(hit.id)) next.add(hit.id);
    this.setSelection(next);
  }

  /** The drag a press starts besides pan and window: a grip drag in the live drawing. */
  protected beginDrag(_at: Point, _shift: boolean): DragHandler | null {
    return null;
  }

  /** Space held is the second way to pan (the first is the middle button). */
  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  pointerDown(at: Point, button: number, shift: boolean): void {
    if (button === 1 || (button === 0 && this.spaceHeld)) {
      this.drag = this.panDrag(at);
    } else if (button === 0 && this.snapshot.sheet === null) {
      this.drag = this.beginDrag(at, shift) ?? this.pressDrag(at);
    } else if (button === 0) {
      this.drag = this.panDrag(at);
    }
  }

  pointerMove(at: Point): void {
    this.hoverAt(at);
    this.drag?.move(at);
  }

  pointerUp(at: Point, shift: boolean): void {
    const drag = this.drag;
    this.drag = null;
    drag?.end(at, shift);
  }

  pointerLeave(): void {
    this.pointerGone();
  }

  /** The pointer is over the pane at `at`: the snap attributes follow it on every move. */
  private hoverAt(at: Point): void {
    if (this.snapshot.sheet !== null) return;
    const resolved = this.resolve(at);
    if (!sameSnap(this.snapshot.hover.snap, resolved.snap)) this.update({ hover: { snap: resolved.snap } });
    this.pointerMoved(screenToWorld(this.snapshot.view, at), resolved.point);
  }

  /** A hook for the live drawing: the pointer is at `world` and a click there would enter `point`. */
  protected pointerMoved(_world: Point, _point: Point): void {}

  /** A hook for the live drawing: the pointer left the pane. */
  protected pointerGone(): void {}

  wheel(at: Point, deltaY: number): void {
    this.moveView(wheelZoom(this.snapshot.view, at, deltaY));
  }

  private panDrag(start: Point): DragHandler {
    let last = start;
    return {
      move: (at) => {
        this.panBy(at[0] - last[0], at[1] - last[1]);
        last = at;
      },
      end: () => {},
    };
  }

  private pressDrag(start: Point): DragHandler {
    let dragging = false;
    return {
      move: (at) => {
        if (!dragging && distance(at, start) > CLICK_SLOP_PX) dragging = this.allowsWindow();
        if (!dragging) return;
        const { view } = this.snapshot;
        this.update({
          window: {
            x: Math.min(start[0], at[0]),
            y: Math.min(start[1], at[1]),
            width: Math.abs(at[0] - start[0]),
            height: Math.abs(at[1] - start[1]),
            mode: windowMode(screenToWorld(view, start), screenToWorld(view, at)),
          },
        });
      },
      end: (at, shift) => {
        if (!dragging) {
          this.click(at, shift);
          return;
        }
        const { scene, view } = this.snapshot;
        const { ids } = selectInWindow(scene, screenToWorld(view, start), screenToWorld(view, at));
        const next = new Set(this.snapshot.selection);
        for (const id of ids) {
          if (shift) next.delete(id);
          else next.add(id);
        }
        this.update({ window: null });
        this.setSelection(next);
      },
    };
  }

  // ------------------------------------------------------------ aids

  toggleAid(aid: DraftingAid): void {
    const aids = { ...this.snapshot.aids, [aid]: !this.snapshot.aids[aid] };
    if (aids[aid] && aid === 'ortho') aids.polar = false;
    if (aids[aid] && aid === 'polar') aids.ortho = false;
    this.update({ aids });
    this.env.announce(copy.aidToggled(AID_LABEL[aid], aids[aid]));
  }

  // ------------------------------------------------------------ find

  openFind(): void {
    this.update({ find: { ...this.snapshot.find, open: true } });
    this.requestFocus('find');
  }

  closeFind(): void {
    this.update({ find: { open: false, query: '', matches: [], index: -1 } });
    this.requestFocus('command');
  }

  setFindQuery(query: string): void {
    const matches = query === '' ? [] : findEntities(this.snapshot.scene, query);
    this.update({ find: { open: true, query, matches, index: -1 } });
  }

  /** Selects the next match and pans by the least amount that reveals it. With no matches nothing happens. */
  nextMatch(): void {
    const { matches, index } = this.snapshot.find;
    if (matches.length === 0) return;
    const next = (index + 1) % matches.length;
    this.update({ find: { ...this.snapshot.find, index: next } });
    this.selectOnly(matches[next]);
    this.panToEntity(matches[next]);
  }

  // ------------------------------------------------------------ measuring (phone long press: Measure from here)

  /** Starts a two-point distance from `from` (world units); the next tap ends it. */
  startMeasure(from: Point): void {
    this.measureFrom = from;
    this.update({ measuring: true, prompt: PROMPTS.DIST.second });
  }

  /** Ends the distance at `to` and says it in the DIST result format. */
  finishMeasure(to: Point): void {
    if (!this.measureFrom) return;
    const report = distReport(this.measureFrom, to);
    this.measureFrom = null;
    this.update({ measuring: false, prompt: report });
  }

  // ------------------------------------------------------------ prompt and focus

  setPrompt(text: string): void {
    if (this.snapshot.prompt !== text) this.update({ prompt: text });
  }

  requestFocus(target: FocusTarget): void {
    this.update({ focus: { target, seq: ++this.focusSeq } });
  }

  protected setGrips(grips: readonly GripView[]): void {
    if (grips.length > 0 || this.snapshot.grips.length > 0) this.update({ grips });
  }
}
