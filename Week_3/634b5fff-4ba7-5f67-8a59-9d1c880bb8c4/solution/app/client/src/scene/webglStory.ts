import { Matrix4, Quaternion, Vector3 } from "three";
import {
  BUNDLE_MATCHES,
  CHAPTER_EDGES,
  EDITION,
  FLARE_MS,
  PHONE_MAX_WIDTH,
  SPARK_MS,
  TABLET_MAX_WIDTH,
  type CellState,
  type Chapter,
} from "../../../shared/domain.js";
import { Listeners } from "./emitter.js";
import { FlamePoints } from "./flames.js";
import { HandMatches } from "./hand.js";
import {
  FOCUS_DISTANCE,
  FOV_DEG,
  PATH_LENGTH,
  pathForward,
  pathPoint,
  SHELF_DISTANCE,
  SHELF_PLANE_Z,
} from "./path.js";
import { Shelf } from "./shelf.js";
import { Snow } from "./snow.js";
import { GAIN, Stage } from "./stage.js";
import { StoryCore } from "./storyCore.js";
import type { FrameInfo, HoldInput, MatchKind, ShelfLayout, ShelfMapping, StoryController } from "./types.js";
import { Visions } from "./visions.js";
import type { VisionChapter } from "./visionModels.js";

const SHELF_START = CHAPTER_EDGES.shelf;
const FOCUS_MS = 700;
const HELD_SLOT = HandMatches.slots;
const VISION_SLOT = HELD_SLOT + 1;
const FLAME_CAPACITY = VISION_SLOT + Visions.slots;
const SOFTWARE_FRAME_MS = 100;
const FLICKER_FRAME_MS = 80;
const SOFTWARE_FLICKER_FRAME_MS = 200;

/** From this width a vision can stand beside the type column. */
const WIDE_VIEW = 1280;

const smooth = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (low: number, high: number, x: number): number => smooth(Math.min(1, Math.max(0, (x - low) / (high - low))));
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

const defaultLayout = (width: number, height: number): ShelfLayout => {
  const columns = width <= PHONE_MAX_WIDTH ? 6 : width <= TABLET_MAX_WIDTH ? 12 : 20;
  const cellPx = Math.max(44, Math.min(64, Math.floor((width - 32) / columns)));
  return { columns, rows: EDITION / columns, cellPx, left: (width - columns * cellPx) / 2, top: 80, scrollTop: 0, width, height };
};

const flickerOf = (seconds: number): number =>
  (Math.sin(seconds * 21) + 0.7 * Math.sin(seconds * 34 + 1.3) + 0.5 * Math.sin(seconds * 8 + 0.4)) / 2.2;

const now = (): number => performance.now();

const scratch = new Vector3();
const heading = new Vector3();
const lightSpot = new Vector3();
const pathQuaternion = new Quaternion();
const identity = new Quaternion();
const lookMatrix = new Matrix4();
const up = new Vector3(0, 1, 0);
const origin = new Vector3();

/** The WebGL story: one camera on one path through the alley to the shelf, the strike, the visions and the boxes. */
export class WebglStory implements StoryController {
  readonly mode = "webgl" as const;
  private readonly core: StoryCore;
  private readonly stage: Stage;
  private readonly flames = new FlamePoints(FLAME_CAPACITY);
  private readonly snow = new Snow(1100);
  private readonly visions: Visions;
  private readonly hand: HandMatches;
  private readonly shelf: Shelf;
  private readonly frames = new Listeners<FrameInfo>();
  private layout: ShelfLayout;
  private width = 1;
  private height = 1;
  private focus = 0;
  private focusIndex = -1;
  private lastFrame = now();
  private lastRender = -1e9;
  private lastPose = "";
  private dirty = true;
  private visionShown = -1;
  private shadowStale = true;
  private loop = 0;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, private readonly discrete: boolean) {
    this.stage = new Stage(canvas, context);
    this.core = new StoryCore(discrete, {
      cameraPosition: () => this.stage.camera.position,
      lightIntensity: () => this.stage.matchLight.intensity / GAIN,
      litMatches: () => this.hand.lit,
    });
    this.hand = new HandMatches(this.flames, 0);
    this.visions = new Visions(this.flames, VISION_SLOT);
    this.shelf = new Shelf(this.flames, HELD_SLOT, this.stage.heldLight);
    this.stage.camera.add(this.hand.group);
    this.stage.scene.add(this.visions.group, this.shelf.group, this.snow.object, this.flames.object);
    this.layout = defaultLayout(window.innerWidth, window.innerHeight);
    this.measure();
    this.applyPose();
    this.prewarm();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.wake();
  }

  /**
   * (Re)starts the frame loop. Each interaction calls this, so what it starts never waits on a frame already queued
   * behind a busy GPU, as the first one is while the pipelines build; a loop that was replaced stops at its next frame.
   */
  private wake(): void {
    const loop = ++this.loop;
    const step = (): void => {
      if (loop !== this.loop) return;
      requestAnimationFrame(step);
      this.frame();
    };
    requestAnimationFrame(step);
  }

  get chapter(): Chapter {
    return this.core.chapter;
  }

  get litMatches(): number {
    return this.hand.lit;
  }

  setProgress(progress: number): void {
    this.core.setProgress(progress);
    this.applyPose();
    this.wake();
  }

  stepToChapter(chapter: Chapter): void {
    this.core.stepToChapter(chapter);
    this.syncStory(now());
    this.applyPose();
    this.dirty = true;
    this.shadowStale = true;
  }

  strike(): boolean {
    if (!this.core.strike()) return false;
    this.wake();
    const chapter = this.core.chapter as VisionChapter;
    heading.set(0, 0, -1).applyQuaternion(this.stage.camera.quaternion);
    this.visions.place(chapter, this.stage.camera.position, Math.atan2(heading.x, -heading.z), this.width >= WIDE_VIEW);
    this.visionShown = -1;
    this.syncStory(now());
    this.dirty = true;
    this.shadowStale = true;
    return true;
  }

  onMatchOut(listener: (kind: MatchKind) => void): () => void {
    return this.core.matchOut.add(listener);
  }

  onChange(listener: () => void): () => void {
    return this.core.change.add(() => listener());
  }

  subscribe(listener: (info: FrameInfo) => void): () => void {
    return this.frames.add(listener);
  }

  setBoxes(states: readonly CellState[]): void {
    this.shelf.setBoxes(states);
    this.dirty = true;
  }

  setHold(hold: HoldInput | null): void {
    this.core.setHold(hold);
    this.shelf.setHold(hold, this.discrete);
    this.applyPose();
    this.dirty = true;
    this.wake();
  }

  setShelfLayout(layout: ShelfLayout): void {
    this.layout = layout;
    this.shelf.setLayout(layout, this.width, this.height);
    this.applyPose();
    this.dirty = true;
  }

  setDim(amount: number): void {
    this.stage.setDim(Math.min(1, Math.max(0, amount)));
    this.dirty = true;
  }

  shelfMapping(): ShelfMapping {
    const { cellPx, left, top, scrollTop } = this.layout;
    const first = this.screenOf(0);
    const second = this.screenOf(1);
    const k = (second.x - first.x) / cellPx;
    return {
      visible: this.shelfShown(),
      k: round(k),
      tx: round(first.x - left - (k * cellPx) / 2),
      ty: round(first.y - top - k * (cellPx / 2 - scrollTop)),
    };
  }

  private readonly onResize = (): void => {
    this.measure();
    this.dirty = true;
  };

  private readonly onVisibility = (): void => {
    this.lastFrame = now();
    this.dirty = true;
  };

  private measure(): void {
    const canvas = this.stage.renderer.domElement;
    this.width = Math.max(1, canvas.clientWidth || window.innerWidth);
    this.height = Math.max(1, canvas.clientHeight || window.innerHeight);
    this.stage.setSize(this.width, this.height);
    this.hand.layout(this.width / this.height);
    const tan = Math.tan((FOV_DEG * Math.PI) / 360);
    this.snow.setView(tan * (this.width / this.height), tan, this.stage.pixelsPerUnit);
    this.flames.setPixels(this.stage.pixelsPerUnit);
    this.shelf.setLayout(this.layout, this.width, this.height);
  }

  /**
   * Draws every kind of thing once, hidden by the first real frame, so the software renderer builds its pipelines
   * now and not in the middle of the first strike or the first hold.
   */
  private prewarm(): void {
    const { renderer, scene, camera } = this.stage;
    renderer.compile(scene, camera);
    this.visions.setAllVisible(true);
    this.shelf.warm(true);
    this.hand.update(BUNDLE_MATCHES, 1, 0);
    this.stage.setDim(0.01);
    this.flames.commit();
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    this.visions.setAllVisible(false);
    this.shelf.warm(false);
    this.hand.update(0, 0, 0);
    this.stage.setDim(0);
    this.flames.commit();
  }

  /** Pixels per scene unit on the shelf plane, seen from the final pose. */
  private get perUnit(): number {
    return this.height / (2 * SHELF_DISTANCE * Math.tan((FOV_DEG * Math.PI) / 360));
  }

  private get shelfRange(): boolean {
    return this.discrete ? this.core.chapter === "shelf" : this.core.progress >= SHELF_START;
  }

  private shelfShown(): boolean {
    return this.shelfRange || this.focus > 0;
  }

  private screenOf(index: number): { x: number; y: number } {
    this.shelf.cellCenter(index, scratch).project(this.stage.camera);
    return { x: (scratch.x * 0.5 + 0.5) * this.width, y: (-scratch.y * 0.5 + 0.5) * this.height };
  }

  /** Puts the camera where progress, the scrolled grid and hold focus say it is; a pure function of that state. */
  private applyPose(): void {
    const camera = this.stage.camera;
    const progress = this.discrete && this.core.chapter === "shelf" ? 1 : this.core.progress;
    const base = pathPoint(progress);
    const ramp = this.discrete ? (this.core.chapter === "shelf" ? 1 : 0) : smoothstep(SHELF_START, SHELF_START + 0.04, progress);
    const forward = pathForward(progress);
    lookMatrix.lookAt(origin, scratch.set(forward.x, forward.y, forward.z), up);
    pathQuaternion.setFromRotationMatrix(lookMatrix);

    const wanted = this.wantsFocus();
    if (this.core.hold && this.core.hold.number >= 1 && this.core.hold.number <= EDITION) this.focusIndex = this.core.hold.number - 1;
    if (this.discrete) this.focus = wanted ? 1 : 0;
    const weight = smooth(this.focus);
    this.shelf.slideTo((this.layout.scrollTop / this.perUnit) * ramp * (1 - weight));
    if (weight === 0 || this.focusIndex < 0) {
      camera.position.set(base.x, base.y, base.z);
      camera.quaternion.copy(pathQuaternion);
    } else {
      this.shelf.cellCenter(this.focusIndex, scratch);
      const target = { x: scratch.x, y: scratch.y, z: SHELF_PLANE_Z + FOCUS_DISTANCE };
      if (this.focus >= 1) camera.position.set(target.x, target.y, target.z);
      else camera.position.set(base.x + (target.x - base.x) * weight, base.y + (target.y - base.y) * weight, base.z + (target.z - base.z) * weight);
      if (this.focus >= 1) camera.quaternion.copy(identity);
      else camera.quaternion.copy(pathQuaternion).slerp(identity, weight);
    }
    camera.updateMatrixWorld(true);
  }

  /** Whether hold focus is wanted: a hold is live and the camera is in the shelf range. */
  private wantsFocus(): boolean {
    const hold = this.core.hold;
    return hold !== null && this.shelfRange && hold.number >= 1 && hold.number <= EDITION;
  }

  /** The hold focus tween: moves toward 1 while focus is wanted and back to 0 otherwise, in `FOCUS_MS`. */
  private stepFocus(elapsed: number): void {
    const step = elapsed / FOCUS_MS;
    this.focus = this.wantsFocus() ? Math.min(1, this.focus + step) : Math.max(0, this.focus - step);
  }

  /** Brings the light, the hand, the vision and the flames in line with the story state. */
  private syncStory(time: number): void {
    const state = this.core.state;
    const seconds = time / 1000;
    const stage = this.stage;
    const wobble = this.discrete ? 0 : flickerOf(seconds);
    stage.matchLight.intensity = state.level * GAIN;
    stage.glowLight.intensity = (state.burning ? state.level * 0.12 * (1 + wobble) : state.glow) * GAIN;
    const elapsed = state.elapsed(time);
    const flare = state.burning ? Math.min(1, Math.max(0, (elapsed - SPARK_MS) / FLARE_MS)) : 0;
    const spark = state.sparking ? 0.7 + 0.3 * Math.sin(elapsed * 0.9) ** 2 : 0;
    this.hand.update(state.litMatches, state.sparking ? 0 : Math.max(flare, 0.2), spark);
    this.hand.lightAt(lightSpot);
    stage.matchLight.position.copy(lightSpot);
    stage.glowLight.position.copy(lightSpot);
    if (this.visionShown !== state.vision) {
      this.visions.update(state.vision);
      this.visionShown = state.vision;
    }
    this.shelf.flicker(wobble);
  }

  private frame(): void {
    const time = now();
    const elapsed = Math.max(0, time - this.lastFrame);
    this.lastFrame = time;
    if (document.hidden) return;
    this.core.tick(time);
    if (!this.discrete) this.stepFocus(elapsed);
    this.applyPose();
    this.syncStory(time);
    this.updateSnow(time);
    if (this.frames.size > 0) {
      this.frames.emit({
        progress: this.core.progress,
        chapter: this.core.chapter,
        mapping: this.shelfMapping(),
        litMatches: this.hand.lit,
      });
    }
    this.render(time);
  }

  private updateSnow(time: number): void {
    const progress = this.core.progress;
    const visible = 1 - smoothstep(0.84, 0.9, progress);
    const state = this.core.state;
    const warm = state.burning ? 1 : state.glow;
    this.stage.camera.worldToLocal(scratch.copy(lightSpot));
    this.snow.update(this.discrete ? 0 : time / 1000, progress * PATH_LENGTH, visible, warm / (state.peak || 1), scratch);
  }

  private render(time: number): void {
    const state = this.core.state;
    const camera = this.stage.camera;
    const pose = `${camera.position.x},${camera.position.y},${camera.position.z},${camera.quaternion.x},${camera.quaternion.y},${camera.quaternion.z}`;
    if (pose !== this.lastPose) {
      this.lastPose = pose;
      this.dirty = true;
      this.shadowStale = true;
    }
    const drifting = (!this.discrete && this.core.progress < 0.9) || state.animating;
    const flameShown = state.burning || state.glow > 0 || this.shelf.matchLit;
    if (this.stage.setMoving(drifting)) this.dirty = true;
    const frameMs = drifting && this.stage.software ? SOFTWARE_FRAME_MS : 0;
    const flickerMs = this.stage.software ? SOFTWARE_FLICKER_FRAME_MS : FLICKER_FRAME_MS;
    const periodic = drifting ? frameMs : flameShown && !this.discrete && !this.stage.dimmed ? flickerMs : Infinity;
    if (!this.dirty && periodic === Infinity) return;
    if (time - this.lastRender < (this.dirty ? frameMs : periodic)) return;
    if (!this.stage.readyToDraw) return;
    this.lastRender = time;
    this.dirty = false;
    this.flames.setTime(time / 1000);
    this.flames.commit();
    if ((state.burning || state.glow > 0) && (this.shadowStale || state.animating)) {
      this.stage.renderer.shadowMap.needsUpdate = true;
      this.shadowStale = false;
    }
    this.stage.renderer.render(this.stage.scene, camera);
    this.stage.frameDrawn();
  }
}
